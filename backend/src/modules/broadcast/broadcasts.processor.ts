import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EvolutionService } from '../../common/evolution/evolution.service';
import { BROADCAST_QUEUE } from '../queue/queue.module';
import { RealtimeService } from '../realtime/realtime.service';
import { BotsService } from '../bots/bots.service';
import {
  ValidatedStepContent,
  TextContent,
  ListContent,
  ButtonsContent,
  MediaContent,
} from '../bots/broadcast/step-content.validator';

/**
 * 📣 BroadcastProcessor — consome a fila BROADCAST e dispara os envios.
 *
 * Concorrência 1 (processamento serial) para garantir o rate limit por delay.
 * Para cada contato da ContactList:
 *   1. Lê a configuração (delay entre envios) → sleep N segundos.
 *   2. Busca o contato e o WhatsappSession → chama EvolutionService.send*.
 *   3. Atualiza contadores (sent / failed) no BroadcastSchedule.
 *   4. Cria MessageLog.
 *
 * Recorrência (ONCE|DAILY|WEEKLY): ao término do envio, se recurrence != ONCE,
 * reagenda novo job para startAt + (1 dia | 7 dias).
 *
 * Nota: o job é processado por UM worker host. Para escalar, usar mais
 * workers BullMQ em workers separados por sharding (fora do escopo MVP).
 */
@Processor(BROADCAST_QUEUE, { concurrency: 1 })
export class BroadcastProcessor extends WorkerHost {
  private readonly logger = new Logger(BroadcastProcessor.name);
  private readonly sendDelayMs: number;
  /// Limite "leitura-consciente":  proporcional a  msgs/hora permitidas.
  /// Para 5000 msgs/hora → 720ms. Para default 1800/hora → 2000ms.

  constructor(
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionService,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
    private readonly botsService: BotsService,
  ) {
    super();
    this.sendDelayMs =
      parseInt(this.config.get<string>('broadcast.sendDelaySec') ?? '2', 10) * 1000;
  }

  async process(job: Job<{ broadcastId: string; tenantId: string; isTesting?: boolean }>) {
    const { broadcastId, tenantId } = job.data;
    const isTesting = job.data.isTesting === true;
    this.logger.log(`[job=${job.id}] Iniciando broadcast ${broadcastId} (tenant ${tenantId}${isTesting ? ', testing' : ''})`);

    try {
      await this.runBroadcast(job, broadcastId, isTesting);
      if (job.name === 'finish-broadcast' || job.name === 'send-broadcast') {
        await this.maybeReschedule(broadcastId);
      }
    } catch (err) {
      this.logger.error(`[job=${job.id}] Broadcast falhou: ${(err as Error).message}`);
      throw err;
    }
  }

  private async runBroadcast(job: Job, broadcastId: string, isTesting = false) {
    const broadcast = await this.prisma.broadcastSchedule.findUnique({
      where: { id: broadcastId },
      include: { bot: { select: { testContactPhone: true, name: true } } },
    });
    if (!broadcast) {
      this.logger.warn(`Broadcast ${broadcastId} não encontrado — abortando`);
      return;
    }
    if (broadcast.status === 'paused') {
      this.logger.log(`Broadcast ${broadcastId} está pausado — abortando (job permanece)`);
      return;
    }

    // Em testing, validar que o testContactPhone está na ContactList. Se não
    // estiver, marcamos erro e saímos (defensivo — service já valida, mas o
    // contato pode ter sido removido entre create e run).
    let testPhone: string | null = null;
    if (isTesting) {
      testPhone = broadcast.bot.testContactPhone ?? null;
      if (!testPhone) {
        this.logger.warn(
          `Broadcast ${broadcastId} em testing sem testContactPhone — abortando`,
        );
        await this.prisma.broadcastSchedule.update({
          where: { id: broadcastId },
          data: { status: 'completed' },
        });
        return;
      }
    }

    // Marca como running (se scheduled).
    if (broadcast.status === 'scheduled') {
      await this.prisma.broadcastSchedule.update({
        where: { id: broadcastId },
        data: { status: 'running' },
      });
    }

    // 🤖 S24 — Identifica sessão WhatsApp ATIVA e VINCULADA a este bot via
    // SessionSettings.activeBotId. Antes o broadcast disparava pela
    // "primeira sessão connected do tenant", o que podia usar uma sessão
    // associada a outro bot (multi-bot no mesmo workspace). Agora exigimos
    // vínculo explícito (gate simétrico ao de BroadcastsService.create):
    // se não há sessão vinculada, marcamos como paused e o usuário é
    // avisado pela UI (status no BroadcastList + WS broadcast.progress).
    const session = await this.prisma.whatsappSession.findFirst({
      where: {
        tenantId: broadcast.tenantId,
        status: 'connected',
        settings: { activeBotId: broadcast.botId },
      },
      select: { sessionName: true, name: true },
    });
    if (!session) {
      this.logger.warn(
        `Broadcast ${broadcastId}: nenhuma sessão conectada vinculada ` +
          `ao bot ${broadcast.botId} — marcando como paused`,
      );
      const updated = await this.prisma.broadcastSchedule.update({
        where: { id: broadcastId },
        data: { status: 'paused' },
      });
      this.emitProgress(broadcast.tenantId, updated);
      return;
    }

    // Busca contatos pendentes (ainda não enviados neste broadcast).
    const sentLogs = await this.prisma.messageLog.findMany({
      where: { broadcastId, direction: 'outbound' },
      select: { contactId: true },
    });
    const sentIds = new Set(sentLogs.map((x) => x.contactId));

    const items = await this.prisma.contactListItem.findMany({
      where: { contactListId: broadcast.contactListId },
      include: { contact: { select: { id: true, phone: true } } },
    });
    // Em testing, mantém apenas o item cujo contato === testContactPhone.
    const scopedItems = isTesting
      ? items.filter((i) => i.contact.phone === testPhone)
      : items;

    const conteudo = broadcast.mensagem as unknown as ValidatedStepContent & { type?: string };
    const tipo =
      (conteudo.type as string) ??
      // fallback p/ quando `mensagem` veio sem `type` (legacy/DTO):
      (broadcast.mensagem as Record<string, unknown>).textMessage !== undefined
        ? 'text'
        : 'text';

    let totalSent = 0;
    let totalFailed = 0;
    for (const item of scopedItems) {
      // Rate limit: dorme entre mensagens.
      if (totalSent > 0 || totalFailed > 0) {
        await this.delay(this.sendDelayMs);
      }
      if (sentIds.has(item.contact.id)) continue;

      try {
        await this.send(session.sessionName, item.contact.phone, tipo, conteudo);
        await this.prisma.messageLog.create({
          data: {
            tenantId: broadcast.tenantId,
            broadcastId: broadcast.id,
            contactId: item.contact.id,
            direction: 'outbound',
            type: tipo,
            content: broadcast.mensagem as unknown as Prisma.InputJsonValue,
            status: 'sent',
          },
        });
        totalSent++;
        const updated = await this.prisma.broadcastSchedule.update({
          where: { id: broadcast.id },
          data: {
            sent: { increment: 1 },
            pending: { decrement: 1 },
            lastRunAt: new Date(),
          },
        });
        this.emitProgress(broadcast.tenantId, updated);
      } catch (err) {
        this.logger.warn(
          `Broadcast ${broadcast.id}: falhou envio para ${item.contact.phone}: ${(err as Error).message}`,
        );
        await this.prisma.messageLog.create({
          data: {
            tenantId: broadcast.tenantId,
            broadcastId: broadcast.id,
            contactId: item.contact.id,
            direction: 'outbound',
            type: tipo,
            content: broadcast.mensagem as unknown as Prisma.InputJsonValue,
            status: 'failed',
            error: (err as Error).message.slice(0, 1000),
          },
        });
        totalFailed++;
        const updated = await this.prisma.broadcastSchedule.update({
          where: { id: broadcast.id },
          data: { failed: { increment: 1 }, pending: { decrement: 1 } },
        });
        this.emitProgress(broadcast.tenantId, updated);
      }
    }

    await this.prisma.broadcastSchedule.update({
      where: { id: broadcast.id },
      data: { status: 'completed' },
    });
    this.logger.log(
      `[job=${job.id}] Broadcast ${broadcastId} concluído: sent=${totalSent} failed=${totalFailed}`,
    );
  }

  private async maybeReschedule(broadcastId: string) {
    const broadcast = await this.prisma.broadcastSchedule.findUnique({
      where: { id: broadcastId },
      select: { recurrence: true, startAt: true, status: true, contactListId: true, botId: true, tenantId: true },
    });
    if (!broadcast) return;

    // 🤖 S24 — Auto-inativar bot quando campanha única (ONCE) conclui.
    // O ciclo de vida agora é: o bot fica ativo enquanto há campanha
    // ativa; quando a campanha única termina, ele vira 'inactive'
    // automaticamente (cascade desconecta sessões WhatsApp vinculadas,
    // igual ao fluxo manual de "Inativar"). Recorrências (DAILY/WEEKLY/
    // MONTHLY) continuam ativas entre execuções.
    if (broadcast.recurrence === 'ONCE') {
      if (broadcast.status === 'completed') {
        await this.autoDeactivateBot(
          broadcast.botId,
          broadcast.tenantId,
          'completed',
        );
      }
      return;
    }
    if (broadcast.status !== 'completed') return;

    const next = new Date(broadcast.startAt);
    if (broadcast.recurrence === 'DAILY') next.setDate(next.getDate() + 1);
    else if (broadcast.recurrence === 'WEEKLY') next.setDate(next.getDate() + 7);
    else if (broadcast.recurrence === 'MONTHLY') next.setMonth(next.getMonth() + 1);
    else return;

    const count = await this.prisma.contactListItem.count({
      where: { contactListId: broadcast.contactListId },
    });

    await this.prisma.broadcastSchedule.update({
      where: { id: broadcastId },
      data: {
        status: 'scheduled',
        startAt: next,
        sent: 0,
        failed: 0,
        pending: count,
        totalContacts: count,
      },
    });
  }

  private delay(ms: number) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 🤖 S24 — Auto-inativa o bot dono do broadcast quando a campanha única
   * (ONCE) conclui. Reaproveita BotsService.update({status:'inactive'}), que
   * dispara cascadeDisconnectSessions (desconecta as sessões WhatsApp
   * vinculadas ao bot, via WhatsappSessionsService.logout). A desconexão é
   * fire-and-forget; se o bot já estiver inactive/testing, nada a fazer.
   */
  private async autoDeactivateBot(botId: string, tenantId: string, reason: string) {
    try {
      const bot = await this.prisma.bot.findFirst({
        where: { id: botId, tenantId },
        select: { id: true, status: true },
      });
      if (!bot || bot.status === 'inactive' || bot.status === 'testing') return;

      await this.botsService.update(tenantId, botId, { status: 'inactive' });
      this.logger.log(
        `Bot ${botId} auto-inativado após campanha ${reason} (status: ${bot.status} → inactive)`,
      );
    } catch (err) {
      // Nunca deve derrubar o worker — campanha já concluiu.
      this.logger.error(
        `autoDeactivateBot(${botId}) falhou: ${(err as Error).message}`,
      );
    }
  }

  private emitProgress(tenantId: string, b: {
    id: string;
    status: string;
    totalContacts: number;
    sent: number;
    pending: number;
    failed: number;
    lastRunAt: Date | null;
    updatedAt: Date;
  }) {
    this.realtime.emitBroadcastProgress(tenantId, {
      id: b.id,
      status: b.status,
      totalContacts: b.totalContacts,
      sent: b.sent,
      pending: b.pending,
      failed: b.failed,
      lastRunAt: b.lastRunAt?.toISOString() ?? null,
      updatedAt: b.updatedAt.toISOString(),
    });
  }

  private async send(sessionName: string, phone: string, tipo: string, conteudo: ValidatedStepContent & { type?: string }) {
    if (tipo === 'text') {
      const c = conteudo as unknown as TextContent;
      await this.evolution.sendText(sessionName, { number: phone, text: c.text });
    } else if (tipo === 'list') {
      const c = conteudo as unknown as ListContent;
      await this.evolution.sendList(sessionName, {
        number: phone,
        title: c.title,
        footerText: c.text,
        buttonText: c.buttonText,
        sections: c.sections,
      });
    } else if (tipo === 'buttons') {
      const c = conteudo as unknown as ButtonsContent;
      await this.evolution.sendButtons(sessionName, {
        number: phone,
        title: c.text,
        ...(c.footer ? { footer: c.footer } : {}),
        buttons: c.buttons,
      });
    } else if (tipo === 'media') {
      const c = conteudo as unknown as MediaContent;
      if (c.mediaType === 'image') {
        await this.evolution.sendImage(sessionName, { number: phone, url: c.url, caption: c.caption });
      } else if (c.mediaType === 'video') {
        await this.evolution.sendVideo(sessionName, { number: phone, url: c.url, caption: c.caption });
      } else if (c.mediaType === 'audio') {
        await this.evolution.sendAudio(sessionName, { number: phone, url: c.url });
      } else if (c.mediaType === 'document') {
        await this.evolution.sendDocument(sessionName, {
          number: phone,
          url: c.url,
          filename: c.url.split('/').pop() ?? 'file',
        });
      } else if (c.mediaType === 'sticker') {
        await this.evolution.sendSticker(sessionName, { number: phone, url: c.url });
      }
    }
  }
}
