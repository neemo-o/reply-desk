import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EvolutionService } from '../../../common/evolution/evolution.service';
import {
  EvolutionMessageParser,
  ParsedIncomingMessage,
} from '../../../common/evolution/evolution-message-parser.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { isUuid } from '../../../common/utils/security';
import {
  ValidatedStepContent,
  ListContent,
  ButtonsContent,
  MediaContent,
  TextContent,
  HandoffContent,
} from '../broadcast/step-content.validator';
import { isOpenAt, parseBusinessHours } from '../broadcast/business-hours';

export interface BotInboundContext {
  whatsappSessionId: string;
  tenantId: string;
  sessionName: string;
  contactId: string;
  phone: string;
  message: ParsedIncomingMessage;
  externalId?: string;
}

/**
 * 🤖 BotEngineService — motor de decisão dos bots SIMPLE e AGENTS.
 *
 * Auto (AUTO) é totalmente offline — não processa inbound; apenas dispara via
 * BroadcastProcessor.
 *
 * Resumo do fluxo por tipo:
 *  - SIMPLE:  em qualquer inbound válido, responde UMA vez com o step ordem=1
 *             e marca BotSession status='finished'. Se já existe sessão (mesmo
 *             finished) para (bot, contato), não reenvia.
 *  - AGENTS:  em inbound:
 *               1. se BotSession ativa → avalia resposta → avança step.
 *               2. se sem sessão e trigger casa → cria sessão no step 1.
 *               3. step HANDOFF → marca BotSession 'routed', seta
 *                  Conversation.assignedUser (se actionConfig.assignUserId).
 *
 * Comportamentos transversais:
 *  - Modo testing (bot.status='testing'): só responde/mantém sessão se
 *    `contact.phone === bot.testContactPhone`. Outros contatos: persiste log
 *    inbound e NÃO processa.
 *  - Fora de horário (Tenant.businessHours e bot.offlineMessage): se contato
 *    está fora do horário e bot.offlineMessage !== null, envia a mensagem de
 *    fora de horário (uma vez por contato a cada janela nova) e não avança o
 *    fluxo.
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

  async processInbound(ctx: BotInboundContext): Promise<void> {
    try {
      const finalSession = await this.prisma.$transaction(
        async (tx) => this.handleInbound(tx, ctx),
        { timeout: 8000 },
      );
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
      this.logger.error(
        `BotEngine falhou p/ contato ${ctx.contactId}: ${(err as Error).message}`,
      );
    }
  }

  private async handleInbound(
    tx: Prisma.TransactionClient,
    ctx: BotInboundContext,
  ): Promise<{
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
    if (!settings?.activeBotId) return null;

    // Aceita SIMPLE e AGENTS. AUTO é ignorado pelo engine.
    const bot = await tx.bot.findFirst({
      where: {
        id: settings.activeBotId,
        tenantId: ctx.tenantId,
        status: { in: ['active', 'testing'] },
        type: { in: ['SIMPLE', 'AGENTS'] },
      },
      select: {
        id: true,
        name: true,
        type: true,
        status: true,
        testContactPhone: true,
        offlineMessage: true,
      },
    });
    if (!bot) return null;

    // 2. Concorrência humano.
    const humanActive = await this.isContactInHumanAttendance(
      tx,
      ctx.whatsappSessionId,
      ctx.contactId,
    );
    if (humanActive) {
      this.logger.log(
        `contato ${ctx.contactId} em atendimento humano — bot ${bot.id} NÃO processa`,
      );
      return null;
    }

    // 3. Idempotência.
    if (ctx.externalId) {
      const dup = await tx.messageLog.findFirst({
        where: {
          externalId: ctx.externalId,
          direction: 'inbound',
          botId: bot.id,
        },
        select: { id: true },
      });
      if (dup) return null;
    }

    // Loga mensagem recebida.
    await tx.messageLog.create({
      data: {
        tenantId: ctx.tenantId,
        botId: bot.id,
        contactId: ctx.contactId,
        direction: 'inbound',
        type: ctx.message.type,
        content: {
          text: ctx.message.text,
          selectedId: ctx.message.selectedId,
        } as unknown as Prisma.InputJsonValue,
        status: 'received',
        ...(ctx.externalId ? { externalId: ctx.externalId } : {}),
      },
    });

    // 4. Modo testing — só responde ao testContactPhone.
    if (bot.status === 'testing') {
      if (!bot.testContactPhone || ctx.phone !== bot.testContactPhone) {
        this.logger.log(
          `bot ${bot.id} em testing — contato ${ctx.phone} ignorado (esperado ${bot.testContactPhone ?? '-'})`,
        );
        return null;
      }
    }

    // 5. Fora de horário — se offlineMessage definido e contato fora do
    //    horário, envia mensagem única e aborta o fluxo.
    const offlineSent = await this.handleBusinessHours(tx, bot, ctx);
    if (offlineSent) {
      return null;
    }

    // 6. Carrega/recupera sessão.
    let session = await tx.botSession.findFirst({
      where: { botId: bot.id, contactId: ctx.contactId, status: 'active' },
      include: { currentStep: true },
    });

    // 7. SIMPLE: só step 1, sem condições/triggers multi-step.
    if (bot.type === 'SIMPLE') {
      return this.handleSimpleInbound(tx, bot, ctx, session);
    }

    // 8. AGENTS: igual ao fluxo histórico.
    if (!session) {
      const triggerHit = await this.matchTrigger(tx, bot.id, ctx.message);
      if (!triggerHit) return null;
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

    if (!session.currentStep) {
      const finished = await tx.botSession.update({
        where: { id: session.id },
        data: { status: 'finished', currentStepId: null },
        include: { currentStep: true },
      });
      return this.toSessionSummary(finished, bot.id);
    }
    return this.evaluateStepResponse(tx, session, ctx);
  }

  /**
   * Bot SIMPLE: o contato envia qualquer mensagem → respondemos com step ordem=1
   * (uma única vez por contato). Sessão nasce/termina em 'finished'.
   */
  private async handleSimpleInbound(
    tx: Prisma.TransactionClient,
    bot: { id: string; name: string; testContactPhone: string | null; status: string },
    ctx: BotInboundContext,
    existing: { id: string; status: string } | null,
  ): Promise<{ id: string; botId: string; status: string; currentStep: { ordem: number } | null } | null> {
    // Se já existe sessão (qualquer status), não reenvia a mensagem.
    if (existing) {
      return {
        id: existing.id,
        botId: bot.id,
        status: existing.status,
        currentStep: null,
      };
    }
    const step = await tx.botStep.findFirst({
      where: { botId: bot.id, ordem: 1 },
      orderBy: { ordem: 'asc' },
    });
    if (!step) {
      this.logger.warn(`bot SIMPLE ${bot.id} sem step ordem=1`);
      return null;
    }
    const created = await tx.botSession.create({
      data: {
        botId: bot.id,
        contactId: ctx.contactId,
        tenantId: ctx.tenantId,
        currentStepId: step.id,
        status: 'finished',
      },
      include: { currentStep: true },
    });
    const exec = { ...created, currentStep: step as never } as never;
    await this.executeStep(tx, exec, ctx);
    return this.toSessionSummary(created, bot.id);
  }

  /**
   * Verifica horário de atendimento do tenant. Se o contato está fora do
   * horário e `bot.offlineMessage` está definido, envia a offlineMessage e
   * retorna `true` (caller deve abortar o fluxo normal).
   * Retorna `false` se: sem offlineMessage, sem businessHours (24/7), ou
   * dentro do horário.
   */
  private async handleBusinessHours(
    tx: Prisma.TransactionClient,
    bot: { id: string; offlineMessage: string | null },
    ctx: BotInboundContext,
  ): Promise<boolean> {
    if (!bot.offlineMessage) return false;
    const tenant = await tx.tenant.findFirst({
      where: { id: ctx.tenantId },
      select: { timezone: true, businessHours: true },
    });
    if (!tenant) return false;
    const bh = parseBusinessHours(tenant.businessHours);
    if (isOpenAt(new Date(), bh, tenant.timezone)) return false;

    try {
      await this.evolution.sendText(ctx.sessionName, {
        number: ctx.phone,
        text: bot.offlineMessage,
      });
    } catch (err) {
      this.logger.warn(
        `falha ao enviar offlineMessage p/ ${ctx.phone}: ${(err as Error).message}`,
      );
    }
    await tx.messageLog.create({
      data: {
        tenantId: ctx.tenantId,
        botId: bot.id,
        contactId: ctx.contactId,
        direction: 'outbound',
        type: 'text',
        content: { type: 'text', text: bot.offlineMessage } as unknown as Prisma.InputJsonValue,
        status: 'pending',
      },
    });
    return true;
  }

  private toSessionSummary(
    session:
      | { id: string; status: string; currentStep: { ordem: number } | null }
      | { id: string; status: string; currentStep?: { ordem: number } | null }
      | null,
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

  private async executeStep(
    tx: Prisma.TransactionClient,
    session: {
      id: string;
      currentStep: {
        id: string;
        botId: string;
        ordem: number;
        tipoMensagem: string;
        conteudo: Prisma.JsonValue;
      } | null;
    },
    ctx: BotInboundContext,
  ) {
    const step = session.currentStep;
    if (!step) return;
    const conteudo = step.conteudo as unknown as ValidatedStepContent;

    // HANDOFF: NÃO envia mensagem normal ao contato; eventualmente envia
    // `conteudo.message` (texto de despedida) e transfere para humano.
    if (step.tipoMensagem === 'handoff') {
      await this.performHandoff(tx, session.id, ctx, conteudo as HandoffContent);
      return;
    }

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

  /**
   * Realiza o handoff: seta Conversation.assignedUser (se actionConfig.assignUserId
   * for válido e pertencer ao tenant) e marca BotSession status='routed'.
   * Opcionalmente envia `conteudo.message` ao contato.
   */
  private async performHandoff(
    tx: Prisma.TransactionClient,
    sessionId: string,
    ctx: BotInboundContext,
    conteudo: HandoffContent,
  ) {
    // Envia mensagem de despedida (opcional).
    if (conteudo.message) {
      try {
        await this.evolution.sendText(ctx.sessionName, {
          number: ctx.phone,
          text: conteudo.message,
        });
      } catch (err) {
        this.logger.warn(
          `handoff: falha ao enviar message p/ ${ctx.phone}: ${(err as Error).message}`,
        );
      }
      await tx.messageLog.create({
        data: {
          tenantId: ctx.tenantId,
          botSessionId: sessionId,
          contactId: ctx.contactId,
          direction: 'outbound',
          type: 'text',
          content: { type: 'text', text: conteudo.message } as unknown as Prisma.InputJsonValue,
          status: 'pending',
        },
      });
    }

    // Atribui conversa a um usuário, se informado em actionConfig.assignUserId.
    const assignUserId = conteudo.actionConfig?.assignUserId;
    const conversation = await tx.conversation.findFirst({
      where: {
        sessionId: ctx.whatsappSessionId,
        contactId: ctx.contactId,
        status: { not: 'closed' },
      },
      select: { id: true, assignedUser: true },
    });
    if (assignUserId) {
      const user = await tx.tenantUser.findFirst({
        where: {
          tenantId: ctx.tenantId,
          userId: assignUserId,
          status: 'active',
        },
        select: { userId: true },
      });
      if (!user) {
        this.logger.warn(
          `handoff: assignUserId ${assignUserId} não encontrado no tenant — conversa NÃO atribuída`,
        );
      } else if (conversation) {
        await tx.conversation.update({
          where: { id: conversation.id },
          data: { assignedUser: user.userId },
        });
      }
    }

    // Marca BotSession como 'routed'.
    await tx.botSession.update({
      where: { id: sessionId },
      data: { status: 'routed', currentStepId: null },
    });
  }

  private async evaluateStepResponse(
    tx: Prisma.TransactionClient,
    session: {
      id: string;
      currentStep: {
        id: string;
        botId: string;
        ordem: number;
        condicoesProximo: Prisma.JsonValue;
        fallbackStepOrder: number | null;
      } | null;
    },
    ctx: BotInboundContext,
  ): Promise<{ id: string; botId: string; status: string; currentStep: { ordem: number } | null } | null> {
    const step = session.currentStep;
    if (!step) return null;

    if (!['text', 'list_response', 'buttons_response'].includes(ctx.message.type)) {
      return this.advance(tx, session, step.botId, step.fallbackStepOrder, ctx);
    }

    const condicoes =
      (step.condicoesProximo as unknown as { match: string; stepOrder: number }[]) ?? [];
    const reply =
      ctx.message.type === 'text'
        ? (ctx.message.text ?? '').toLowerCase().trim()
        : (ctx.message.selectedId ?? '').toLowerCase().trim();

    for (const cond of condicoes) {
      const matchVal = cond.match.toLowerCase().trim();
      if (matchVal === reply) {
        return this.advance(tx, session, step.botId, cond.stepOrder, ctx);
      }
    }
    return this.advance(tx, session, step.botId, step.fallbackStepOrder, ctx);
  }

  private async advance(
    tx: Prisma.TransactionClient,
    session: { id: string },
    botId: string,
    nextOrder: number | null,
    ctx: BotInboundContext,
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
    await this.executeStep(tx, updated as never, ctx);
    return this.toSessionSummary(updated, botId);
  }

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
