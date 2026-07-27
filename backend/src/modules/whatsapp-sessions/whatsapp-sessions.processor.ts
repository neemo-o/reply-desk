import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { EvolutionService } from '../../common/evolution/evolution.service';
import { SESSION_QUEUE } from '../queue/queue.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WhatsappSessionsService } from './whatsapp-sessions.service';

/**
 * 📈 E5 — Processor de sessão WhatsApp.
 *
 * Roda DENTRO do processo worker (worker.ts), não no processo HTTP.
 * Concurrency limitada para não saturar a Evolution API.
 *
 * Jobs:
 *   connect-session    cria instância na Evolution + configura webhook
 *                      (com o secret de validação por instância) e dispara
 *                      a conexão (que produz o QR Code na Evolution).
 *                      O QR fica disponível via /sessions/:id/qr no HTTP.
 *   disconnect-session encerra sessão de forma graciosa (logout Evolution).
 *
 * O backend NUNCA persiste QR Code ou credenciais — esses ficam na
 * Evolution (/evolution_data). Só atualizamos status + evolutionInstanceId
 * no banco após a instância ser criada com sucesso.
 */
@Processor(SESSION_QUEUE, { concurrency: 3 })
export class WhatsappSessionsProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsappSessionsProcessor.name);

  constructor(
    private readonly sessionsService: WhatsappSessionsService,
    private readonly prisma: PrismaService,
    private readonly evolution: EvolutionService,
  ) {
    super();
  }

  async process(job: Job<{
    sessionId: string;
    tenantId?: string;
    webhookSecret: string;
  }>) {
    this.logger.log(`[job=${job.id}] Processando ${job.name} para sessão ${job.data.sessionId}`);

    try {
      if (job.name === 'connect-session') {
        await this.handleConnect(job);
      } else if (job.name === 'disconnect-session') {
        await this.handleDisconnect(job);
      } else {
        this.logger.warn(`[job=${job.id}] Job name desconhecido: ${job.name}`);
      }
    } catch (err) {
      this.logger.error(
        `[job=${job.id}] Falha em ${job.name} sessão ${job.data.sessionId}: ${(err as Error).message}`,
      );
      // BullMQ re-tenta (attempts=3 no controller) — se esgotar, marca erro.
      throw err;
    }
  }

  /**
   * connect-session: cria a instância na Evolution API com o webhook
   * configurado (incluindo o header customizado x-evolution-signature
   * com o secret por instância). A Evolution já dispara o QR Code quando
   * a instância é criada — o frontend busca via GET /sessions/:id/qr.
   */
  private async handleConnect(job: Job<{
    sessionId: string;
    tenantId?: string;
    webhookSecret: string;
  }>) {
    const { sessionId, webhookSecret } = job.data;

    const session = await this.prisma.whatsappSession.findUnique({
      where: { id: sessionId },
      select: { id: true, sessionName: true, phone: true, status: true, tenantId: true },
    });
    if (!session) {
      this.logger.warn(`[job=${job.id}] Sessão ${sessionId} não encontrada no DB — abortando`);
      return;
    }
    if (session.status === 'connected') {
      this.logger.log(`[job=${job.id}] Sessão ${sessionId} já conectada — skip`);
      return;
    }

    // 🔒 Atualiza status -> qrcode_pending antes de criar a instância
    // para o refletir imediatamente no frontend.
    await this.sessionsService.updateStatus(sessionId, 'qrcode_pending');

    const webhookUrl = this.evolution.buildWebhookUrl();
    const signatureHeader = { 'x-evolution-signature': webhookSecret };

    // Cria instância na Evolution. Já com webhook inline (reduz race
    // conditions vs criar e depois setWebhook).
    const result = await this.evolution.createInstance({
      instanceName: session.sessionName,
      webhookUrl,
      webhookSignatureHeader: signatureHeader,
      ...(session.phone ? { number: session.phone } : {}),
    });

    // Persiste evolutionInstanceId retornado pela Evolution.
    await this.sessionsService.updateStatus(sessionId, 'qrcode_pending', {
      evolutionInstanceId: result?.instance?.instanceId,
    });

    this.logger.log(
      `[job=${job.id}] Instância "${session.sessionName}" criada na Evolution (id=${result?.instance?.instanceId}). QR disponível via GET /sessions/${sessionId}/qr`,
    );
  }

  /**
   * disconnect-session: gracioisamente encerra sessão (logout Evolution).
   */
  private async handleDisconnect(job: Job<{ sessionId: string }>) {
    const { sessionId } = job.data;
    const session = await this.prisma.whatsappSession.findUnique({
      where: { id: sessionId },
      select: { sessionName: true, status: true },
    });
    if (!session) return;
    try {
      await this.evolution.logout(session.sessionName);
    } catch (err) {
      this.logger.warn(`[job=${job.id}] logout Evolution falhou: ${(err as Error).message}`);
    }
    await this.sessionsService.updateStatus(sessionId, 'disconnected');
    this.logger.log(`[job=${job.id}] Sessão ${sessionId} → disconnected`);
  }
}
