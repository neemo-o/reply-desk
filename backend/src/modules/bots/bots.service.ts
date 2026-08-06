import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PlanLimitsService } from '../subscriptions/plan-limits.service';
import { CreateBotDto } from './dto/create-bot.dto';
import { UpdateBotDto } from './dto/update-bot.dto';
import { CreateBotTriggerDto } from './dto/create-bot-trigger.dto';
import { UpdateBotTriggerDto } from './dto/update-bot-trigger.dto';
import { CreateBotStepDto } from './dto/create-bot-step.dto';
import { UpdateBotStepDto } from './dto/update-bot-step.dto';
import { validateStepContent } from './broadcast/step-content.validator';
import { isUuid } from '../../common/utils/security';
import { WhatsappSessionsService } from '../whatsapp-sessions/whatsapp-sessions.service';
import { InstanceStatusService } from './instance-status.service';
import { RealtimeService } from '../realtime/realtime.service';

/**
 * 🤖 BotsService — CRUD de bots (3 tipos: SIMPLE, AGENTS, AUTO).
 *
 * Cada tipo segue regras próprias:
 *  - SIMPLE: tem UM step (ordem=1) tipo text/list/buttons/media — nunca handoff.
 *            Não suporta múltiplos steps. Sem triggers (endeusado: sempre first_message).
 *  - AGENTS: suporta N steps + triggers + step final tipo HANDOFF.
 *  - AUTO:   NÃO tem steps nem triggers. Apenas é dono de BroadcastSchedule(s).
 *
 * Regras de status:
 *  - draft    → em edição. BotEngine e scheduler ignoram.
 *  - testing  → só interage com `testContactPhone` (campo em bots).
 *  - active   → em produção.
 *  - inactive → pausado manualmente.
 */
@Injectable()
export class BotsService {
  private readonly logger = new Logger(BotsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitsService,
    @Inject(forwardRef(() => WhatsappSessionsService))
    private readonly sessionsService: WhatsappSessionsService,
    private readonly instanceStatus: InstanceStatusService,
    private readonly realtime: RealtimeService,
  ) {}

  // ─── Bots ────────────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateBotDto) {
    await this.planLimits.assertCanCreateBot(tenantId, dto.type);
    if (dto.testContactPhone && dto.type === 'AUTO') {
      throw new BadRequestException('Bot AUTO não suporta testContactPhone');
    }
    return this.prisma.bot.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        type: dto.type,
        status: dto.testContactPhone && dto.type !== 'AUTO' ? 'testing' : 'draft',
        testContactPhone: dto.testContactPhone ?? null,
        offlineMessage: dto.offlineMessage ?? null,
      },
    });
  }

  /**
   * 🔒 Bug 5 — Retorna a lista de bots do tenant, incluindo o número de
   * sessões Whatss conectadas ativas para cada um (`_count.sessions`).
   *
   * A contagem é mantida consistente com o emitido via WS `bot.sessionCount`
   * (ver `WhatsappSessionsService.emitBotSessionCount`). Anteriormente o
   * select usava a relation `Bot.sessions` (→ BotSession[]) com filtro
   * `status: 'connected'`, mas `BotSession.status` nunca é 'connected'
   * (valores: active/finished/routed/cooldown), fazendo a contagem ser
   * sempre 0.
   */
  async findAll(tenantId: string) {
    const [bots, counts] = await Promise.all([
      this.prisma.bot.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          description: true,
          type: true,
          status: true,
          testContactPhone: true,
          offlineMessage: true,
          updatedAt: true,
          createdAt: true,
          triggers: { select: { id: true, tipo: true, valor: true } },
          _count: {
            select: {
              broadcasts: true,
            },
          },
        },
      }),
      this.countActiveSessionsByBot(tenantId),
    ]);

    return bots.map((b) => ({
      ...b,
      _count: {
        ...b._count,
        // Sessões WhatsApp conectadas que têm este bot como activeBot.
        sessions: counts.get(b.id) ?? 0,
      },
    }));
  }

  /**
   * 🔒 Bug 5 — Conta quantas Whats sessions conectadas estão usando cada bot
   * (via SessionSettings.activeBotId), retornando um map `botId -> count`.
   * Consistente com o que é emitido via `bot.sessionCount` no Realtime.
   */
  private async countActiveSessionsByBot(
    tenantId: string,
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.sessionSettings.findMany({
      where: {
        session: { tenantId, status: 'connected' },
        activeBotId: { not: null },
      },
      select: {
        activeBotId: true,
        session: { select: { id: true } },
      },
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      if (!r.activeBotId) continue;
      map.set(r.activeBotId, (map.get(r.activeBotId) ?? 0) + 1);
    }
    return map;
  }

  async findOne(tenantId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException('Bot não encontrado');
    const bot = await this.prisma.bot.findFirst({
      where: { id, tenantId },
      include: {
        triggers: { orderBy: { createdAt: 'asc' } },
        steps: { orderBy: { ordem: 'asc' } },
      },
    });
    if (!bot) throw new NotFoundException('Bot não encontrado');
    return bot;
  }

  async update(tenantId: string, id: string, dto: UpdateBotDto) {
    const bot = await this.findOne(tenantId, id);
    if (
      dto.status &&
      !['draft', 'testing', 'active', 'inactive'].includes(dto.status)
    ) {
      throw new BadRequestException('status inválido');
    }
    // AUTO não pode ter testContactPhone — defensive.
    if (dto.testContactPhone && bot.type === 'AUTO') {
      throw new BadRequestException('Bot AUTO não suporta testContactPhone');
    }
    // Para entrar em `testing` é obrigatório ter testContactPhone.
    if (dto.status === 'testing' && !bot.testContactPhone && dto.testContactPhone === null) {
      throw new BadRequestException('status=testing requer testContactPhone');
    }

    // 🔒 Bug 4 — Detecta mudança de status que desativa o bot (active/testing →
    // draft/inactive). Quando isto acontece, sessões WhatsApp ativas
    // conectadas a este bot devem ser desconectadas (logout Evolution) e o
    // usuário notificado via WS com o motivo.
    const nextStatus = dto.status ?? bot.status;
    const wasActive = bot.status === 'active' || bot.status === 'testing';
    const willBeInactive = nextStatus === 'draft' || nextStatus === 'inactive';
    if (wasActive && willBeInactive) {
      // Dispara em background — não bloqueia o update do bot (logout pode ser lento).
      this.cascadeDisconnectSessions(bot.id, tenantId, bot.status, nextStatus).catch(
        (err) =>
          this.logger.error(
            `cascadeDisconnectSessions(bot=${bot.id}) falhou: ${(err as Error).message}`,
          ),
      );
    }

    // 🔒 Bug 6 — Se está ativando o bot (draft/inactive → active/testing),
    // verifica o limite de bots ativos do plano. Bots em testing também contam
    // contra maxActiveBots, pois são tratados como ativos.
    const wasInactiveForLimits = bot.status === 'draft' || bot.status === 'inactive';
    const willCountAsActive = nextStatus === 'active' || nextStatus === 'testing';
    if (willCountAsActive && wasInactiveForLimits) {
      await this.planLimits.assertCanActivateBot(tenantId, bot.id);
    }

    return this.prisma.bot.update({
      where: { id: bot.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.testContactPhone !== undefined
          ? { testContactPhone: dto.testContactPhone }
          : {}),
        ...(dto.offlineMessage !== undefined ? { offlineMessage: dto.offlineMessage } : {}),
      },
    });
  }

  /**
   * 🔒 Bug 4 — Desconecta as sessões WhatsApp ativas que usam este bot como
   * bot ativo nos `SessionSettings`. Registrado em `session_events` (logs de
   * conexão) com mensagem legível explicando o motivo. WS emite instance.status
   * para a UI mostrar banner alertando ao usuário.
   *
   * Chamado em background (fire-and-forget) — não bloqueia o update do bot.
   */
  private async cascadeDisconnectSessions(
    botId: string,
    tenantId: string,
    previousStatus: string,
    newStatus: string,
  ): Promise<void> {
    const sessions = await this.prisma.whatsappSession.findMany({
      where: {
        tenantId,
        status: 'connected',
        settings: { activeBotId: botId },
      },
      select: { id: true, name: true, tenantId: true },
    });
    if (sessions.length === 0) return;

    const reason = `Bot inativado (status: ${previousStatus} → ${newStatus}). A sessão foi desconectada automaticamente.`;
    this.logger.log(
      `Bot ${botId} mudou de ${previousStatus} → ${newStatus}; desconectando ${sessions.length} sessão(ões) ativas`,
    );

    let disconnected = 0;
    for (const session of sessions) {
      try {
        await this.sessionsService.logout(tenantId, session.id);
        await this.sessionsService.logEvent(session.id, tenantId, 'disconnected', {
          message: reason,
        });
        disconnected += 1;
      } catch (err) {
        this.logger.warn(
          `cascadeDisconnect: falha ao desligar sessão ${session.id} (${session.name}): ${(err as Error).message}`,
        );
      }
    }

    // 🔒 Bug 4 — Notifica o frontend via WS para mostrar a mudança de status
    // imediatamente (banner "Sessão desconectada: bot foi inativado").
    if (disconnected > 0) {
      try {
        const status = await this.instanceStatus.getStatus(tenantId);
        this.realtime.emitInstanceStatus(tenantId, status);
      } catch (err) {
        this.logger.debug(
          `cascadeDisconnect: emitInstanceStatus falhou: ${(err as Error).message}`,
        );
      }
    }
  }

  async remove(tenantId: string, id: string) {
    const bot = await this.findOne(tenantId, id);
    // 🔒 Bug 4 — Desconecta sessões ativas que usavam este bot. Como o bot
    // será deletado (cascade de SessionSettings.activeBotId=SetNull), o
    // SessionSettings.activeBotId vira null e a sessão fica "sem bot".
    // Desconectamos antes para avisar o usuário com motivo claro.
    this.cascadeDisconnectSessions(bot.id, tenantId, bot.status, 'deleted').catch(
      (err) =>
        this.logger.error(
          `cascadeDisconnectSessions(bot=${bot.id}, delete) falhou: ${(err as Error).message}`,
        ),
    );
    await this.prisma.bot.delete({ where: { id: bot.id } });
    return { success: true };
  }

  // ─── Triggers (apenas AGENTS) ──────────────────────────────────────

  async createTrigger(tenantId: string, botId: string, dto: CreateBotTriggerDto) {
    const bot = await this.assertAgentsBot(tenantId, botId);
    if (dto.tipo === 'keyword' && (!dto.valor || dto.valor.trim().length === 0)) {
      throw new BadRequestException('valor obrigatório quando tipo=keyword');
    }
    return this.prisma.botTrigger.create({
      data: {
        botId: bot.id,
        tipo: dto.tipo,
        valor: dto.tipo === 'keyword' ? dto.valor : null,
      },
    });
  }

  async updateTrigger(tenantId: string, botId: string, triggerId: string, dto: UpdateBotTriggerDto) {
    await this.assertAgentsBot(tenantId, botId);
    const trigger = await this.prisma.botTrigger.findFirst({
      where: { id: triggerId, botId },
    });
    if (!trigger) throw new NotFoundException('Trigger não encontrado');
    if (dto.tipo === 'keyword' && dto.valor !== undefined && dto.valor.trim().length === 0) {
      throw new BadRequestException('valor obrigatório quando tipo=keyword');
    }
    const data: { tipo?: string; valor?: string | null } = {};
    if (dto.tipo !== undefined) data.tipo = dto.tipo;
    if (dto.valor !== undefined) data.valor = dto.tipo === 'first_message' ? null : dto.valor;
    if (dto.tipo === 'first_message') data.valor = null;
    return this.prisma.botTrigger.update({ where: { id: trigger.id }, data });
  }

  async removeTrigger(tenantId: string, botId: string, triggerId: string) {
    await this.assertAgentsBot(tenantId, botId);
    const trigger = await this.prisma.botTrigger.findFirst({
      where: { id: triggerId, botId },
      select: { id: true },
    });
    if (!trigger) throw new NotFoundException('Trigger não encontrado');
    await this.prisma.botTrigger.delete({ where: { id: trigger.id } });
    return { success: true };
  }

  // ─── Steps (SIMPLE: 1 único step ordem=1 | AGENTS: N steps) ────────

  async createStep(tenantId: string, botId: string, dto: CreateBotStepDto) {
    const bot = await this.assertBotForSteps(tenantId, botId);
    const validated = validateStepContent(dto.tipoMensagem, dto.conteudo);

    // Regras específicas por tipo de bot:
    if (bot.type === 'SIMPLE') {
      if (dto.ordem !== 1) {
        throw new BadRequestException('Bot SIMPLE aceita apenas um step com ordem=1');
      }
      if (dto.tipoMensagem === 'handoff') {
        throw new BadRequestException('Bot SIMPLE não suporta step handoff');
      }
      // Garante que não há steps pré-existentes.
      const existing = await this.prisma.botStep.findFirst({
        where: { botId: bot.id },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException('Bot SIMPLE aceita apenas um step');
      }
    }

    const existing = await this.prisma.botStep.findFirst({
      where: { botId: bot.id, ordem: dto.ordem },
      select: { id: true },
    });
    if (existing) throw new BadRequestException(`Já existe step com ordem ${dto.ordem}`);
    return this.prisma.botStep.create({
      data: {
        botId: bot.id,
        ordem: dto.ordem,
        tipoMensagem: dto.tipoMensagem,
        conteudo: validated as unknown as Prisma.InputJsonValue,
        condicoesProximo:
          (dto.condicoesProximo as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        fallbackStepOrder: dto.fallbackStepOrder ?? null,
      },
    });
  }

  async updateStep(tenantId: string, botId: string, stepId: string, dto: UpdateBotStepDto) {
    const bot = await this.assertBotForSteps(tenantId, botId);
    const step = await this.prisma.botStep.findFirst({
      where: { id: stepId, botId },
    });
    if (!step) throw new NotFoundException('Step não encontrado');

    // Bot SIMPLE não pode virar handoff nem mudar de ordem.
    if (bot.type === 'SIMPLE') {
      if (dto.tipoMensagem === 'handoff') {
        throw new BadRequestException('Bot SIMPLE não suporta step handoff');
      }
      if (dto.ordem !== undefined && dto.ordem !== 1) {
        throw new BadRequestException('Bot SIMPLE só permite step ordem=1');
      }
    }

    if (dto.ordem !== undefined) {
      const clash = await this.prisma.botStep.findFirst({
        where: { botId, ordem: dto.ordem, NOT: { id: step.id } },
        select: { id: true },
      });
      if (clash) throw new BadRequestException(`Já existe outro step com ordem ${dto.ordem}`);
    }
    const validated =
      dto.tipoMensagem && dto.conteudo
        ? validateStepContent(dto.tipoMensagem, dto.conteudo)
        : undefined;

    return this.prisma.botStep.update({
      where: { id: step.id },
      data: {
        ...(dto.ordem !== undefined ? { ordem: dto.ordem } : {}),
        ...(dto.tipoMensagem !== undefined ? { tipoMensagem: dto.tipoMensagem } : {}),
        ...(validated
          ? { conteudo: validated as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.condicoesProximo !== undefined
          ? {
              condicoesProximo:
                (dto.condicoesProximo as unknown as Prisma.InputJsonValue) ??
                Prisma.JsonNull,
            }
          : {}),
        ...(dto.fallbackStepOrder !== undefined ? { fallbackStepOrder: dto.fallbackStepOrder } : {}),
      },
    });
  }

  async removeStep(tenantId: string, botId: string, stepId: string) {
    await this.assertBotForSteps(tenantId, botId);
    const step = await this.prisma.botStep.findFirst({
      where: { id: stepId, botId },
      select: { id: true },
    });
    if (!step) throw new NotFoundException('Step não encontrado');
    await this.prisma.botStep.delete({ where: { id: step.id } });
    return { success: true };
  }

  // ─── Helpers ───────────────────────────────────────────────────

  /** Apenas bots AGENTS suportam triggers. */
  async assertAgentsBot(tenantId: string, botId: string) {
    if (!isUuid(botId)) throw new NotFoundException('Bot não encontrado');
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, tenantId },
      select: { id: true, type: true },
    });
    if (!bot) throw new NotFoundException('Bot não encontrado');
    if (bot.type !== 'AGENTS') {
      throw new BadRequestException('Operação válida apenas para bots AGENTS');
    }
    return bot;
  }

  /** Bots SIMPLE (1 step) e AGENTS (N steps) suportam steps. AUTO não. */
  async assertBotForSteps(tenantId: string, botId: string) {
    if (!isUuid(botId)) throw new NotFoundException('Bot não encontrado');
    const bot = await this.prisma.bot.findFirst({
      where: { id: botId, tenantId },
      select: { id: true, type: true },
    });
    if (!bot) throw new NotFoundException('Bot não encontrado');
    if (bot.type === 'AUTO') {
      throw new BadRequestException('Bots AUTO não suportam steps');
    }
    return bot;
  }
}
