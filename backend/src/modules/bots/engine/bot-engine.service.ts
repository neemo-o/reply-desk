import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EvolutionService } from '../../../common/evolution/evolution.service';
import {
  EvolutionMessageParser,
  ParsedIncomingMessage,
} from '../../../common/evolution/evolution-message-parser.service';
import { RealtimeService } from '../../realtime/realtime.service';
import { isUuid } from '../../../common/utils/security';
import { phonesEqual } from '../../../common/utils/phone-normalize';
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

  private readonly simpleCooldownMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionService,
    private readonly parser: EvolutionMessageParser,
    private readonly realtime: RealtimeService,
    private readonly configService: ConfigService,
  ) {
    const cooldownHours =
      this.configService.get<number>('evolution.simpleCooldownHours') ?? 12;
    this.simpleCooldownMs = Math.max(0, cooldownHours) * 60 * 60 * 1000;
  }

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
        tenant: {
          select: {
            id: true,
            timezone: true,
            businessHours: true,
            offlineMessage: true,
            welcomeMessage: true,
          },
        },
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
      if (!bot.testContactPhone || !phonesEqual(ctx.phone, bot.testContactPhone)) {
        this.logger.log(
          `bot ${bot.id} em testing — contato ${ctx.phone} ignorado (esperado ${bot.testContactPhone ?? '-'})`,
        );
        return null;
      }
    }

    // 5. Fora de horário — só AGENTS honra o horário de atendimento.
    //    Bots SIMPLE não usam horário: enviam a única mensagem sempre que acionados,
    //    então a mensagem fora do horário nunca se aplica e não é verificada.
    if (bot.type !== 'SIMPLE') {
      const offlineSent = await this.handleBusinessHours(tx, bot, ctx);
      if (offlineSent) {
        return null;
      }
    }

    // 6. Carrega/recupera sessão.
    let session = await tx.botSession.findFirst({
      where: { botId: bot.id, contactId: ctx.contactId, status: 'active' },
      include: { currentStep: true },
    });

    // 7. SIMPLE: só step 1, sem condições/triggers multi-step.
    if (bot.type === 'SIMPLE') {
      // 🔒 Bug 3 — Cooldown: precisa também da última sessão não-active
      // (finished/cooldown/routed) para checar se pode re-enviar.
      const anySession = session
        ? session
        : await tx.botSession.findFirst({
            where: { botId: bot.id, contactId: ctx.contactId },
            orderBy: { updatedAt: 'desc' },
            select: { id: true, status: true, lastSentAt: true },
          });
      return this.handleSimpleInbound(tx, bot, ctx, anySession);
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
          lastSentAt: new Date(),
        },
        include: { currentStep: true },
      });
      // 🔒 Bug 2 — Envia welcomeMessage do tenant (se definida) ANTES do step 1.
      // Justamente quando a conversa está sendo iniciada (não quando retoma).
      await this.maybeSendWelcome(tx, bot, ctx);
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
   * 🔒 Bug 2 — Envia a mensagem de boas-vindas do tenant (se configurada)
   * quando uma NOVA conversa é iniciada. Não-interrompe o fluxo — se falhar,
   * segue o step 1 normalmente. Persistida em MessageLog para a UI mostrar.
   */
  private async maybeSendWelcome(
    tx: Prisma.TransactionClient,
    bot: { id: string; tenant?: { welcomeMessage: string | null } | null },
    ctx: BotInboundContext,
  ): Promise<void> {
    const welcome = bot.tenant?.welcomeMessage;
    if (!welcome) return;
    try {
      await this.evolution.sendText(ctx.sessionName, {
        number: ctx.phone,
        text: welcome,
      });
    } catch (err) {
      this.logger.warn(
        `falha ao enviar welcomeMessage p/ ${ctx.phone}: ${(err as Error).message}`,
      );
    }
    await tx.messageLog.create({
      data: {
        tenantId: ctx.tenantId,
        botId: bot.id,
        contactId: ctx.contactId,
        direction: 'outbound',
        type: 'text',
        content: { type: 'text', text: welcome } as unknown as Prisma.InputJsonValue,
        status: 'pending',
      },
    });
  }

  /**
   * Bot SIMPLE: o contato envia qualquer mensagem → respondemos com step ordem=1
   * (uma única vez por contato). Sessão nasce/termina em 'finished'.
   *
   * 🔒 Bug 3 — Cooldown de 12h: se já existe sessão finished para este
   * (bot, contato), só reenvia o step 1 se já passaram ≥12h desde o último
   * envio (lastSentAt). Caso contrário, ignora a mensagem (return null-like).
   *
   * 🔒 Em SIMPLE, o contato envia qualquer mensagem → respondemos UMA vez
   * com step ordem=1 e marcamos BotSession status='finished'. Se já existe
   * sessão finished para (bot, contato), só reenvia o step 1 se já passaram
   * ≥ cooldown configurado desde o último envio. Caso contrário, ignora a
   * mensagem.
   */
  private async handleSimpleInbound(
    tx: Prisma.TransactionClient,
    bot: { id: string; name: string; testContactPhone: string | null; status: string },
    ctx: BotInboundContext,
    existing: { id: string; status: string; lastSentAt?: Date | null } | null,
  ): Promise<{ id: string; botId: string; status: string; currentStep: { ordem: number } | null } | null> {
    const COOLDOWN_MS = this.simpleCooldownMs;

    // 🔒 Bug 3 — Se já existe sessão (active/finished/cooldown/routed),
    // respeita o cooldown._sessões não-active significam que o fluxo já
    // rodou (active=em fluxo, finished=concluído, routed=handoff, cooldown=idle).
    if (existing) {
      const lastSent = existing.lastSentAt ? new Date(existing.lastSentAt).getTime() : null;
      const now = Date.now();
      const inCooldown = lastSent !== null && now - lastSent < COOLDOWN_MS;

      if (existing.status === 'active') {
        // Sessão em fluxo (não deveria acontecer em SIMPLE, mas segurança):
        // não re-envia, mantém ativa — o usuário deve responder ao step atual.
        return {
          id: existing.id,
          botId: bot.id,
          status: existing.status,
          currentStep: null,
        };
      }

      // finished/routed/cooldown — só re-envia se cooldown esgotou.
      // 🔒 Exceção: em testing, ignora o cooldown e continua p/ reenvio abaixo.
      if (inCooldown) {
        this.logger.log(
          `bot SIMPLE ${bot.id} em cooldown p/ contato ${ctx.contactId} ` +
          `(último envio=${lastSent ? new Date(lastSent).toISOString() : '-'}, faltam ${
            Math.ceil((COOLDOWN_MS - (now - (lastSent ?? 0))) / 60000)
          } min) — não reenvia`,
        );
        // Marca status cooldown para diagnóstico (transição válida: finished → cooldown).
        await tx.botSession.update({
          where: { id: existing.id },
          data: { status: 'cooldown' },
        });
        return {
          id: existing.id,
          botId: bot.id,
          status: 'cooldown',
          currentStep: null,
        };
      }

      // Cooldown esgotado — RE-ENVIA o step 1 (cria nova sessão? não: reusa
      // a existente, setando status finished e lastSentAt=now).
      const step = await tx.botStep.findFirst({
        where: { botId: bot.id, ordem: 1 },
        orderBy: { ordem: 'asc' },
      });
      if (!step) {
        this.logger.warn(`bot SIMPLE ${bot.id} sem step ordem=1`);
        return null;
      }
      this.logger.debug(
        `🤖 handleSimpleInbound — reenviando step 1 (sessão existente ${existing.id}) ` +
        `tipoMensagem=${step.tipoMensagem} conteudo=${JSON.stringify(step.conteudo).slice(0, 500)}`,
      );
      const updated = await tx.botSession.update({
        where: { id: existing.id },
        data: {
          currentStepId: step.id,
          status: 'finished',
          lastSentAt: new Date(),
        },
        include: { currentStep: true },
      });
      const exec = { ...updated, currentStep: step as never } as never;
      await this.executeStep(tx, exec, ctx);
      return this.toSessionSummary(updated, bot.id);
    }

    // Sem sessão prévia — primeiro contato. Cria sessão e envia step 1.
    const step = await tx.botStep.findFirst({
      where: { botId: bot.id, ordem: 1 },
      orderBy: { ordem: 'asc' },
    });
    if (!step) {
      this.logger.warn(`🤖 handleSimpleInbound — bot SIMPLE ${bot.id} sem step ordem=1 (não há mensagem p/ enviar)`);
      return null;
    }
    this.logger.debug(`🤖 handleSimpleInbound — criando BotSession e enviando step 1 (bot ${bot.id} step ${step.id} ordem=${step.ordem})`);
    const created = await tx.botSession.create({
      data: {
        botId: bot.id,
        contactId: ctx.contactId,
        tenantId: ctx.tenantId,
        currentStepId: step.id,
        status: 'finished',
        lastSentAt: new Date(),
      },
      include: { currentStep: true },
    });
    // 🔒 Bug 2 — Envia welcomeMessage do tenant (se houver) antes do step 1.
    await this.maybeSendWelcome(tx, bot, ctx);
    const exec = { ...created, currentStep: step as never } as never;
    await this.executeStep(tx, exec, ctx);
    return this.toSessionSummary(created, bot.id);
  }

  /**
   * Verifica horário de atendimento do tenant. Se o contato está fora do
   * horário e `offlineMessage` está definido, envia a offlineMessage e
   * retorna `true` (caller deve abortar o fluxo normal).
   * Retorna `false` se: sem offlineMessage, sem businessHours (24/7), ou
   * dentro do horário.
   *
   * 🔒 Bug 2 — offlineMessage agora vem preferencialmente do Tenant. Mantemos
   * fallback p/ bot.offlineMessage (deprecated) só se tenant não tiver.
   */
  private async handleBusinessHours(
    tx: Prisma.TransactionClient,
    bot: {
      id: string;
      offlineMessage: string | null;
      tenant?: {
        timezone: string;
        businessHours: Prisma.JsonValue;
        offlineMessage: string | null;
      } | null;
    },
    ctx: BotInboundContext,
  ): Promise<boolean> {
    // 🔒 Bug 2 — Preferência: Tenant.offlineMessage > Bot.offlineMessage (deprecated).
    const tenantOffline = bot.tenant?.offlineMessage ?? null;
    const botOffline = bot.offlineMessage; // fallback deprecated
    const offlineMessage = tenantOffline ?? botOffline;
    if (!offlineMessage) return false;

    // Já temos o tenant carregado no `bot.tenant` — usamos pra evitar queries extras.
    let timezone: string;
    let businessHours: Prisma.JsonValue;
    if (bot.tenant) {
      timezone = bot.tenant.timezone;
      businessHours = bot.tenant.businessHours;
    } else {
      // Fallback defensivo: se o tenant não veio no `bot`, busca agora.
      const tenant = await tx.tenant.findFirst({
        where: { id: ctx.tenantId },
        select: { timezone: true, businessHours: true },
      });
      if (!tenant) return false;
      timezone = tenant.timezone;
      businessHours = tenant.businessHours;
    }

    const bh = parseBusinessHours(businessHours);
    if (isOpenAt(new Date(), bh, timezone)) return false;

    try {
      await this.evolution.sendText(ctx.sessionName, {
        number: ctx.phone,
        text: offlineMessage,
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
        content: { type: 'text', text: offlineMessage } as unknown as Prisma.InputJsonValue,
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
    // 🔒 Bug 3 — Atualiza lastSentAt para suportar cooldown (futuro p/ AGENTS
    // ou reuso em SIMPLE). Atualização leve.
    await tx.botSession.update({
      where: { id: session.id },
      data: { lastSentAt: new Date() },
      select: { id: true },
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
        // 🔒 Defensive: alguns steps legados podem ter sido gravados em formato
        // alternativo (ex.: { type:'text', value:'...' } ou { type:'text', texto:'...' }).
        // Se c.text vier vazio/undefined, tentamos campos comuns antes de falhar.
        const alt = conteudo as unknown as Record<string, unknown>;
        const text =
          (c.text && String(c.text).length > 0 && c.text) ||
          (alt.value as string | undefined) ||
          (alt.texto as string | undefined) ||
          (alt.message as string | undefined) ||
          '';
        if (!text || text.trim().length === 0) {
          this.logger.error(
            `step text sem propriedade "text" não-vazia — keys=${Object.keys(alt).join(',')} ` +
            `conteudo=${JSON.stringify(conteudo).slice(0, 500)}`,
          );
          return;
        }
        this.logger.debug(
          `🤖 sendStepMessage text — text.length=${text.length} preview="${text.slice(0, 60)}"`,
        );
        await this.evolution.sendText(sessionName, { number, text });
      } else if (tipo === 'list') {
        const c = conteudo as ListContent;
        await this.evolution.sendList(sessionName, {
          number,
          title: c.title,
          footerText: c.text,
          buttonText: c.buttonText,
          sections: c.sections,
        });
      } else if (tipo === 'buttons') {
        const c = conteudo as ButtonsContent;
        await this.evolution.sendButtons(sessionName, {
          number,
          title: c.text,
          ...(c.footer ? { footer: c.footer } : {}),
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
