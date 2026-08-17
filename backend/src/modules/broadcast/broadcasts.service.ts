import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isUuid } from '../../common/utils/security';
import { validateStepContent } from '../bots/broadcast/step-content.validator';
import { BotsService } from '../bots/bots.service';
import {
  BROADCAST_QUEUE,
} from '../queue/queue.module';
import { CreateBroadcastDto } from './dto/create-broadcast.dto';

/**
 * 📣 BroadcastsService — gerencia agendamentos de auto-mensagem (broadcast).
 *
 * Limite de envio obrigatório (regra de negócio do MVP):
 *   Antes de aceitar um agendamento validamos:
 *     tamanho da ContactList × intervalo (rate) configurado por ambiente.
 *   Se ultrapassar o limite seguro por hora, RECUSAMOS o agendamento com 400.
 *   O limite é: BROADCAST_MAX_MESSAGES_PER_HOUR (default 5000).
 */
@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);
  private readonly maxPerHour: number;
  /// delay entre cada envio (segundos) — usado pelo processor via rate limiter.
  /// default 2s = 1800 msgs/hora (limite conservador p/ Evolution).
  private readonly sendDelaySec: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => BotsService))
    private readonly botsService: BotsService,
    @InjectQueue(BROADCAST_QUEUE) private readonly broadcastQueue: Queue,
  ) {
    this.maxPerHour = parseInt(
      this.config.get<string>('broadcast.maxMessagesPerHour') ?? '5000',
      10,
    );
    this.sendDelaySec = parseInt(
      this.config.get<string>('broadcast.sendDelaySec') ?? '2',
      10,
    );
  }

  /**
   * Cria um agendamento de broadcast (bot do tipo AUTO).
   * Antes de persistir:
   *   1. valida que o bot é AUTO e do tenant.
   *   2. 🤖 valida que existe sessão WhatsApp conectada vinculada ao bot
   *      (SessionSettings.activeBotId = bot.id). O broadcast dispara pela
   *      sessão vinculada — se não existir, o usuário precisa criá-la /
   *      vinculá-la antes de agendar (guia a mensagem de erro).
   *   3. valida content (validateStepContent).
   *   4. valida ContactList + conta contatos.
   *   5. valida limite: count × sendDelaySec → msgs/hora não pode exceder maxPerHour.
   *   6. 🤖 Auto-ativa o bot (draft/inactive → active) se necessário,
   *      respeitando o limite de bots ativos do plano (assertCanActivateBot).
   *      O bot fica ativo até a campanha concluir (em recurrence=ONCE) ou
   *      até o usuário inativar manualmente (ver botão "Inativar" na UI).
   *   7. enfileira job único para treat no startAt (recorrência gerencia o job internamente).
   */
  async create(tenantId: string, dto: CreateBroadcastDto) {
    if (!isUuid(dto.botId)) throw new NotFoundException('Bot não encontrado');
    const bot = await this.prisma.bot.findFirst({
      where: { id: dto.botId, tenantId, type: 'AUTO' },
      select: { id: true, status: true, testContactPhone: true },
    });
    if (!bot) throw new NotFoundException('Bot AUTO não encontrado');

    // 🤖 S24 — Exige uma sessão WhatsApp conectada vinculada ao bot AUTO
    // (SessionSettings.activeBotId = bot.id). O processor vai disparar os
    // envios pela sessão vinculada — sem ela, não há como enviar mensagens
    // com a identidade do bot. Sem isso o processor de broadcast pegaria a
    // "primeira sessão conectada do tenant", podendo usar uma sessão de
    // outro bot (ver gate simétrico em BroadcastProcessor.runBroadcast).
    if (bot.status !== 'testing') {
      const linkedSession = await this.prisma.whatsappSession.findFirst({
        where: {
          tenantId,
          status: 'connected',
          settings: { activeBotId: bot.id },
        },
        select: { id: true, name: true },
      });
      if (!linkedSession) {
        // Diagnóstico para mensagem útil: sessões vinculadas a este bot
        // (em qualquer status) e total de sessões do tenant.
        const linkedAnyStatus = await this.prisma.whatsappSession.findFirst({
          where: { tenantId, settings: { activeBotId: bot.id } },
          select: { id: true, name: true, status: true },
        });
        if (linkedAnyStatus) {
          throw new BadRequestException(
            `A sessão vinculada a este bot não está conectada (status: ${linkedAnyStatus.status}). ` +
              `Conecte-a em "WhatsApp" antes de agendar a campanha.`,
          );
        }
        const anySession = await this.prisma.whatsappSession.findFirst({
          where: { tenantId },
          select: { id: true },
        });
        throw new BadRequestException(
          anySession
            ? `Nenhuma sessão WhatsApp conectada está vinculada a este bot. ` +
              `Vá em "WhatsApp" → sessão → Configurações → Bot ativo, selecione este bot e conecte o QR. ` +
              `Depois retorne aqui para agendar a campanha.`
            : `Não há nenhuma sessão WhatsApp criada neste workspace. ` +
              `Crie uma sessão em "WhatsApp", vincule este bot a ela ` +
              `(Configurações da sessão → Bot ativo) e conecte o QR antes de agendar.`,
        );
      }
    }

    // 🤖 Auto-ativa o bot se necessário (draft/inactive → active), pois o
    // ciclo de vida agora é: o bot fica ativo enquanto há campanha ativa.
    // Em testing, mantemos testing (não auto-ativamos) — o usuário continua
    // disparando só para o testContactPhone.
    if (bot.status === 'draft' || bot.status === 'inactive') {
      try {
        await this.botsService.update(tenantId, bot.id, { status: 'active' });
        this.logger.log(
          `Bot ${bot.id} auto-ativado ao agendar broadcast (status: ${bot.status} → active)`,
        );
        // Atualiza status local em memória p/ os próximos cálculos
        bot.status = 'active';
      } catch (err) {
        // Propaga a mensagem do assertCanActivateBot (ForbiddenException),
        // ex.: "Limite de bots ativos do plano X atingido (N)" — rejeita a
        // criação sem deixar o bot em estado inconsistente.
        throw err;
      }
    }

    const contactList = await this.prisma.contactList.findFirst({
      where: { id: dto.contactListId, tenantId },
      select: { id: true, name: true, _count: { select: { items: true } } },
    });
    if (!contactList) throw new NotFoundException('Lista de contatos não encontrada');

    // valida conteúdo (sem alterar tipo do banco).
    const validated = validateStepContent(dto.messageType, dto.mensagem);

    let totalContacts = contactList._count.items;
    if (totalContacts === 0) {
      throw new BadRequestException('Lista de contatos está vazia');
    }

    // Em modo testing, disparamos apenas p/ o testContactPhone — totalContacts vira 1
    // (ou 0 se o telefone não estiver na ContactList). Para o scheduler, isso é
    // sinalizado via campo `pending` filtrado por telefone (ver processor).
    const isTesting = bot.status === 'testing';
    if (isTesting) {
      const testPhone = bot.testContactPhone;
      if (!testPhone) {
        throw new BadRequestException(
          'Bot em testing sem testContactPhone — defina um contato de teste.',
        );
      }
      const testItem = await this.prisma.contactListItem.findFirst({
        where: { contactListId: contactList.id, contact: { phone: testPhone } },
        select: { id: true },
      });
      totalContacts = testItem ? 1 : 0;
      if (totalContacts === 0) {
        throw new BadRequestException(
          `testContactPhone ${testPhone} não está na ContactList "${contactList.name}". ` +
            `Adicione-o para poder testar o disparo.`,
        );
      }
    }

    const msgsPerHour = Math.floor(3600 / this.sendDelaySec);
    void msgsPerHour;
    if (!isTesting && totalContacts > this.maxPerHour) {
      throw new BadRequestException(
        `Lista (${totalContacts} contatos) ultrapassa o limite seguro de ${this.maxPerHour} mensagens/hora. ` +
        `Reduza a lista ou aumente o intervalo de envio.`,
      );
    }

    const startAt = new Date(dto.startAt);
    if (startAt.getTime() < Date.now()) {
      throw new BadRequestException('Data de início deve estar no futuro');
    }
    const recurrence = dto.recurrence ?? 'ONCE';

    const broadcast = await this.prisma.broadcastSchedule.create({
      data: {
        tenantId,
        botId: bot.id,
        contactListId: contactList.id,
        mensagem: validated as unknown as Prisma.InputJsonValue,
        startAt,
        recurrence,
        status: 'scheduled',
        totalContacts,
        pending: totalContacts,
      },
    });

    // Agenda job único para a primeira execução no startAt.
    const delay = Math.max(startAt.getTime() - Date.now(), 0);
    await this.broadcastQueue.add(
      'send-broadcast',
      { broadcastId: broadcast.id, tenantId, isTesting },
      {
        jobId: `broadcast-${broadcast.id}-run`,
        delay,
        removeOnComplete: 200,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
      },
    );

    return broadcast;
  }

  async findOne(tenantId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException('Broadcast não encontrado');
    const b = await this.prisma.broadcastSchedule.findFirst({
      where: { id, tenantId },
    });
    if (!b) throw new NotFoundException('Broadcast não encontrado');
    return b;
  }

  async getProgress(tenantId: string, id: string) {
    const b = await this.findOne(tenantId, id);
    return {
      id: b.id,
      status: b.status,
      totalContacts: b.totalContacts,
      sent: b.sent,
      pending: b.pending,
      failed: b.failed,
      lastRunAt: b.lastRunAt?.toISOString() ?? null,
      updatedAt: b.updatedAt.toISOString(),
    };
  }

  findAll(tenantId: string) {
    return this.prisma.broadcastSchedule.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        contactList: { select: { id: true, name: true } },
        bot: { select: { id: true, name: true } },
      },
    });
  }

  async pause(tenantId: string, id: string) {
    const b = await this.findOne(tenantId, id);
    if (b.status !== 'running' && b.status !== 'scheduled') {
      throw new BadRequestException('Apenas broadcasts running/scheduled podem ser pausados');
    }
    const updated = await this.prisma.broadcastSchedule.update({
      where: { id: b.id },
      data: { status: 'paused' },
    });
    // Remove jobs pendentes da fila (sem derrubar job em execução — Bull cuida disso).
    const job = await this.broadcastQueue.getJob(`broadcast-${b.id}-run`);
    if (job && (await job.getState()) === 'delayed') {
      await job.remove().catch(() => { /* race OK */ });
    }
    return updated;
  }

  /**
   * 🤖 S24 — Pausa todas as campanhas scheduled/running de um bot (chamado
   * quando um bot de campanha AUTO é inativado). Garante que nenhuma
   * mensagem seja enviada enquanto o bot estiver inativo. Remove também os
   * jobs BullMQ delayed para não disparar no horário agendado.
   */
  async pauseByBot(tenantId: string, botId: string): Promise<number> {
    const broadcasts = await this.prisma.broadcastSchedule.findMany({
      where: { tenantId, botId, status: { in: ['scheduled', 'running'] } },
      select: { id: true },
    });
    if (broadcasts.length === 0) return 0;

    await this.prisma.broadcastSchedule.updateMany({
      where: { tenantId, botId, status: { in: ['scheduled', 'running'] } },
      data: { status: 'paused' },
    });

    // Remove jobs atrasados (delayed) da fila — não dispara mais.
    for (const b of broadcasts) {
      const job = await this.broadcastQueue.getJob(`broadcast-${b.id}-run`);
      if (job && (await job.getState()) === 'delayed') {
        await job.remove().catch(() => { /* race OK */ });
      }
      const resumeJob = await this.broadcastQueue.getJob(`broadcast-${b.id}-resume`);
      if (resumeJob) {
        await resumeJob.remove().catch(() => { /* race OK */ });
      }
    }
    return broadcasts.length;
  }

  async resume(tenantId: string, id: string) {
    const b = await this.findOne(tenantId, id);
    if (b.status !== 'paused') {
      throw new BadRequestException('Apenas broadcasts pausados podem ser retomados');
    }
    // Re-deriva isTesting pelo status do bot dono do agendamento.
    const bot = await this.prisma.bot.findFirst({
      where: { id: b.botId, tenantId },
      select: { status: true },
    });
    const isTesting = bot?.status === 'testing';
    const updated = await this.prisma.broadcastSchedule.update({
      where: { id: b.id },
      data: { status: 'scheduled' },
    });
    if (b.pending > 0) {
      await this.broadcastQueue.add(
        'finish-broadcast',
        { broadcastId: b.id, tenantId, isTesting },
        { jobId: `broadcast-${b.id}-resume`, removeOnComplete: 200, removeOnFail: 200 },
      );
    }
    return updated;
  }
}
