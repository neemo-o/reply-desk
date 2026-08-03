import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EvolutionService } from '../../../common/evolution/evolution.service';
import { EvolutionMessageParser, ParsedIncomingMessage } from '../../../common/evolution/evolution-message-parser.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { isUuid } from '../../../common/utils/security';
import {
  ValidatedStepContent,
  ListContent,
  ButtonsContent,
  MediaContent,
  TextContent,
} from '../broadcast/step-content.validator';

export interface BotInboundContext {
  /// sessão WhatsApp que originou a mensagem (deste backend)
  whatsappSessionId: string;
  tenantId: string;
  sessionName: string;
  /// contato (já upsertido pelo webhook handler).
  contactId: string;
  /// telefone E.164 do contato (para enviar respostas).
  phone: string;
  /// mensagem parseada (texto, list_response, etc.).
  message: ParsedIncomingMessage;
  /// id externo (WA message id) para idempotência.
  externalId?: string;
}

/**
 * 🤖 BotEngineService — motor de decisão do bot convencional.
 *
 * Lifecycle (inbound webhook MESSAGES_UPSERT):
 *  1. Busca o bot ativo vinculado à WhatsappSession (SessionSettings.activeBotId).
 *  2. Verifica concorrência: contato em atendimento humano ativo (assignedUser != null)?
 *     Se sim, NÃO processa o bot — apenas persiste a mensagem (feito no webhook handler).
 *  3. Avalia triggers (keyword / first_message).
 *  4. Para trigger hit: cria ou recupera BotSession e executa o step atual.
 *  5. Para trigger não-hit mas BotSession ativa existente: avalia condições de avanço.
 *
 * Decisão de step (evalStep):
 *  - match: compara `selectedId` (list/buttons) ou `text` (case-insensitive)
 *    contra cada condição em `condicoesProximo`. Cadou → step.order.
 *  - sem match: vai para `fallbackStepOrder`. Se null → finaliza sessão (status=finished).
 */
@Injectable()
export class BotEngineService {
  private readonly logger = new Logger(BotEngineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionService,
    private readonly parser: EvolutionMessageParser,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * Processa uma mensagem recebida. Idempotente — se `externalId` foi
   * registrado antes como outbound/inbound do bot, é ignorado.
   * Não lança — falhas são logadas apenas (webhook deve sempre retornar 200).
   */
  async processInbound(ctx: BotInboundContext): Promise<void> {
    try {
      const finalSession = await this.prisma.$transaction(async (tx) => {
        return this.handleInbound(tx, ctx);
      }, { timeout: 8000 });
      if (finalSession) {
        this.realtime.emitBotSessionChange(ctx.tenantId, {
          id: finalSession.id,
          botId: finalSession.botId,
          contactId: ctx.contactId,
          status: finalSession.status,
          currentStepOrdem: finalSession.currentStep?.ordem ?? null,
        });
      }
    } catch (err) {
      this.logger.error(`BotEngine falhou p/ contato ${ctx.contactId}: ${(err as Error).message}`);
    }
  }

  private async handleInbound(tx: Prisma.TransactionClient, ctx: BotInboundContext): Promise<{
    id: string;
    botId: string;
    status: string;
    currentStep: { ordem: number } | null;
  } | null> {
    // 1. Identifica o bot ativo da sessão.
    const settings = await tx.sessionSettings.findUnique({
      where: { sessionId: ctx.whatsappSessionId },
      select: { activeBotId: true },
    });
    if (!settings?.activeBotId) {
      // Sem bot ativo — não há o que fazer.
      return null;
    }

    const bot = await tx.bot.findFirst({
      where: { id: settings.activeBotId, tenantId: ctx.tenantId, status: 'active', type: 'CONVENTIONAL' },
      select: { id: true, name: true },
    });
    if (!bot) {
      return null;
    }

    // 2. Concorrência: contato em atendimento humano ativo?
    const humanActive = await this.isContactInHumanAttendance(tx, ctx.whatsappSessionId, ctx.contactId);
    if (humanActive) {
      this.logger.log(
        `contato ${ctx.contactId} em atendimento humano — bot ${bot.id} NÃO processa`,
      );
      return null;
    }

    // 3. Idempotência: se já logamos essa mensagem inbound, sem reprocessar.
    if (ctx.externalId) {
      const dup = await tx.messageLog.findFirst({
        where: { externalId: ctx.externalId, direction: 'inbound', botId: bot.id },
        select: { id: true },
      });
      if (dup) return null;
    }

    // Loga a mensagem recebida.
    await tx.messageLog.create({
      data: {
        tenantId: ctx.tenantId,
        botId: bot.id,
        contactId: ctx.contactId,
        direction: 'inbound',
        type: ctx.message.type,
        content: { text: ctx.message.text, selectedId: ctx.message.selectedId } as unknown as Prisma.InputJsonValue,
        status: 'received',
        ...(ctx.externalId ? { externalId: ctx.externalId } : {}),
      },
    });

    // 4. Recupera sessão ativa do contato neste bot (xor com criação).
    let session = await tx.botSession.findFirst({
      where: { botId: bot.id, contactId: ctx.contactId, status: 'active' },
      include: { currentStep: true },
    });

    // 5. Sem sessão ativa — avalia triggers para iniciar.
    if (!session) {
      const triggerHit = await this.matchTrigger(tx, bot.id, ctx.message);
      if (!triggerHit) return null;

      // Cria sessão apontando para o step de ordem 1 (entrada).
      const firstStep = await tx.botStep.findFirst({
        where: { botId: bot.id, ordem: 1 },
        orderBy: { ordem: 'asc' },
      });
      if (!firstStep) {
        this.logger.warn(`bot ${bot.id} sem step inicial — trigger ignorado`);
        return null;
      }
      session = await tx.botSession.create({
        data: {
          botId: bot.id,
          contactId: ctx.contactId,
          tenantId: ctx.tenantId,
          currentStepId: firstStep.id,
          status: 'active',
        },
        include: { currentStep: true },
      });
      await this.executeStep(tx, session, ctx);
      return this.toSessionSummary(session, bot.id);
    }

    // 6. Sessão ativa — avalia condições do step atual.
    if (!session.currentStep) {
      // Step atual sumiu (deletado entre sessions). Encerra.
      const finished = await tx.botSession.update({
        where: { id: session.id },
        data: { status: 'finished', currentStepId: null },
        include: { currentStep: true },
      });
      return this.toSessionSummary(finished, bot.id);
    }
    const advanced = await this.evaluateStepResponse(tx, session, ctx);
    return advanced;
  }

  private toSessionSummary(
    session: { id: string; status: string; currentStep: { ordem: number } | null } | { id: string; status: string; currentStep?: { ordem: number } | null } | null,
    botId: string,
  ): { id: string; botId: string; status: string; currentStep: { ordem: number } | null } | null {
    if (!session) return null;
    return {
      id: session.id,
      botId,
      status: session.status,
      currentStep: (session.currentStep ?? null) as { ordem: number } | null,
    };
  }

  /**
   * Verifica se o contato está em atendimento humano ativo:
   * Conversation com mesmo (sessionId, contactId) com assignedUser != null e status != 'closed'.
   */
  private async isContactInHumanAttendance(
    tx: Prisma.TransactionClient,
    whatsappSessionId: string,
    contactId: string,
  ): Promise<boolean> {
    const conversation = await tx.conversation.findFirst({
      where: {
        sessionId: whatsappSessionId,
        contactId,
        status: { not: 'closed' },
        assignedUser: { not: null },
      },
      select: { id: true },
    });
    return Boolean(conversation);
  }

  /**
   * Avalia os triggers do bot contra a mensagem recebida.
   * - tipo 'first_message' → qualquer mensagem (texto ou outro tipo relevante).
   * - tipo 'keyword' → message.text bate com o valor (case-insensitive).
   */
  private async matchTrigger(
    tx: Prisma.TransactionClient,
    botId: string,
    message: ParsedIncomingMessage,
  ): Promise<boolean> {
    const triggers = await tx.botTrigger.findMany({ where: { botId } });
    if (triggers.length === 0) return false;

    const text = (message.text ?? '').toLowerCase().trim();
    for (const t of triggers) {
      if (t.tipo === 'first_message') return true;
      if (t.tipo === 'keyword' && t.valor && text.includes(t.valor.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  /**
   * Executa o step atual: envia a mensagem ao contato e atualiza a sessão.
   */
  private async executeStep(
    tx: Prisma.TransactionClient,
    session: { id: string; currentStep: { id: string; botId: string; ordem: number; tipoMensagem: string; conteudo: Prisma.JsonValue } | null },
    ctx: BotInboundContext,
  ) {
    const step = session.currentStep;
    if (!step) return;

    const conteudo = step.conteudo as unknown as ValidatedStepContent;
    await this.sendStepMessage(ctx, step.tipoMensagem, conteudo);

    await tx.messageLog.create({
      data: {
        tenantId: ctx.tenantId,
        botId: step.botId,
        botSessionId: session.id,
        contactId: ctx.contactId,
        direction: 'outbound',
        type: step.tipoMensagem,
        content: step.conteudo as unknown as Prisma.InputJsonValue,
        status: 'pending',
      },
    });
  }

  private async evaluateStepResponse(
    tx: Prisma.TransactionClient,
    session: { id: string; currentStep: { id: string; botId: string; ordem: number; condicoesProximo: Prisma.JsonValue; fallbackStepOrder: number | null } | null },
    ctx: BotInboundContext,
  ): Promise<{ id: string; botId: string; status: string; currentStep: { ordem: number } | null } | null> {
    const step = session.currentStep;
    if (!step) return null;

    // Apenas tipos relevantes avançam. Outros (mídia, reação) → fallback.
    if (!['text', 'list_response', 'buttons_response'].includes(ctx.message.type)) {
      return this.advance(tx, session, step.botId, step.fallbackStepOrder, ctx, true);
    }

    const condicoes = (step.condicoesProximo as unknown as { match: string; stepOrder: number }[]) ?? [];
    const reply =
      ctx.message.type === 'text'
        ? (ctx.message.text ?? '').toLowerCase().trim()
        : (ctx.message.selectedId ?? '').toLowerCase().trim();

    for (const cond of condicoes) {
      const matchVal = cond.match.toLowerCase().trim();
      if (matchVal === reply || (ctx.message.type !== 'text' && matchVal === (ctx.message.selectedId ?? '').toLowerCase())) {
        return this.advance(tx, session, step.botId, cond.stepOrder, ctx, false);
      }
    }

    return this.advance(tx, session, step.botId, step.fallbackStepOrder, ctx, true);
  }

  /**
   * Move a sessão para outro step (por ordem) ou encerra.
   * Se `isFallback=true`, marca a transição como fallback.
   */
  private async advance(
    tx: Prisma.TransactionClient,
    session: { id: string },
    botId: string,
    nextOrder: number | null,
    ctx: BotInboundContext,
    isFallback: boolean,
  ): Promise<{ id: string; botId: string; status: string; currentStep: { ordem: number } | null } | null> {
    if (nextOrder === null || nextOrder === undefined) {
      const finished = await tx.botSession.update({
        where: { id: session.id },
        data: { status: 'finished', currentStepId: null },
        include: { currentStep: true },
      });
      return this.toSessionSummary(finished, botId);
    }
    const nextStep = await tx.botStep.findFirst({
      where: { botId, ordem: nextOrder },
    });
    if (!nextStep) {
      this.logger.warn(`bot ${botId}: step de ordem ${nextOrder} não encontrado; encerrando`);
      const finished = await tx.botSession.update({
        where: { id: session.id },
        data: { status: 'finished', currentStepId: null },
        include: { currentStep: true },
      });
      return this.toSessionSummary(finished, botId);
    }
    const updated = await tx.botSession.update({
      where: { id: session.id },
      data: { currentStepId: nextStep.id },
      include: { currentStep: true },
    });
    void isFallback;
    await this.executeStep(tx, updated as never, ctx);
    return this.toSessionSummary(updated, botId);
  }

  /**
   * Envia a mensagem do step ao contato via Evolution API.
   * Tipos suportados: text, list, buttons, media (image|video|audio|document|sticker).
   */
  private async sendStepMessage(
    ctx: BotInboundContext,
    tipo: string,
    conteudo: ValidatedStepContent,
  ) {
    const sessionName = ctx.sessionName;
    const number = ctx.phone;
    try {
      if (tipo === 'text') {
        const c = conteudo as TextContent;
        await this.evolution.sendText(sessionName, { number, text: c.text });
      } else if (tipo === 'list') {
        const c = conteudo as ListContent;
        await this.evolution.sendList(sessionName, {
          number,
          title: c.title,
          buttonText: c.buttonText,
          text: c.title,
          sections: c.sections,
        });
      } else if (tipo === 'buttons') {
        const c = conteudo as ButtonsContent;
        await this.evolution.sendButtons(sessionName, {
          number,
          text: c.text,
          buttons: c.buttons,
        });
      } else if (tipo === 'media') {
        const c = conteudo as MediaContent;
        if (c.mediaType === 'image') {
          await this.evolution.sendImage(sessionName, { number, url: c.url, caption: c.caption });
        } else if (c.mediaType === 'video') {
          await this.evolution.sendVideo(sessionName, { number, url: c.url, caption: c.caption });
        } else if (c.mediaType === 'audio') {
          await this.evolution.sendAudio(sessionName, { number, url: c.url });
        } else if (c.mediaType === 'document') {
          await this.evolution.sendDocument(sessionName, {
            number,
            url: c.url,
            filename: c.url.split('/').pop() ?? 'file',
          });
        } else if (c.mediaType === 'sticker') {
          await this.evolution.sendSticker(sessionName, { number, url: c.url });
        }
      }
    } catch (err) {
      this.logger.error(
        `erro ao enviar step ${tipo} via Evolution p/ ${number}: ${(err as Error).message}`,
      );
    }
  }
}
