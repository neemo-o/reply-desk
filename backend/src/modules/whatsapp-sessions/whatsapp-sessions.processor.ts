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
      select: {
        id: true,
        sessionName: true,
        phone: true,
        status: true,
        tenantId: true,
        settings: { select: { activeBotId: true } },
      },
    });
    if (!session) {
      this.logger.warn(`[job=${job.id}] Sessão ${sessionId} não encontrada no DB — abortando`);
      return;
    }
    if (session.status === 'connected') {
      this.logger.log(`[job=${job.id}] Sessão ${sessionId} já conectada — skip`);
      return;
    }

    // 🔒 S24 — Revalida o bot vinculado antes de criar/recriar a instância
    // na Evolution. O endpoint HTTP (/connect ou /reconnect) já validou no
    // momento do enqueue, mas BullMQ roda em worker separado e pode haver
    // delay entre enqueue e execução (fila, retry com backoff). Se o bot
    // foi inativado/deletado nesse intervalo, abortamos a criação da
    // instância — não faz sentido gerar QR para uma sessão cujo bot não
    // vai responder. Em vez de lançar (que faria BullMQ re-tentar 3x só
    // pra falhar igual), ajustamos status e logamos, mantendo a sessão no
    // estado anterior sem instância órfã na Evolution.
    const bot = session.settings?.activeBotId
      ? await this.prisma.bot.findFirst({
          where: { id: session.settings.activeBotId, tenantId: session.tenantId },
          select: { id: true, status: true },
        })
      : null;
    if (!bot || (bot.status !== 'active' && bot.status !== 'testing')) {
      this.logger.warn(
        `[job=${job.id}] Sessão ${sessionId} não tem bot ativo (activeBotId=${session.settings?.activeBotId}, botStatus=${bot?.status ?? 'null'}) — abortando connect-session`,
      );
      await this.sessionsService.updateStatus(sessionId, 'disconnected');
      await this.sessionsService.logEvent(sessionId, session.tenantId, 'disconnected', {
        message: `Conexão abortada: o bot vinculado está inativo ou foi excluído. ` +
          `Ative o bot (ou selecione outro) e gere um novo QR Code.`,
      });
      return;
    }

    // 🔒 Atualiza status -> qrcode_pending antes de criar a instância
    // para o refletir imediatamente no frontend.
    await this.sessionsService.updateStatus(sessionId, 'qrcode_pending');

    // 🪵 S23 — Loga início do processo de conexão
    await this.sessionsService.logEvent(sessionId, session.tenantId, 'qrcode_pending', {
      message: 'Criando instância na Evolution API e gerando QR Code',
    });

    const webhookUrl = this.evolution.buildWebhookUrl();
    const signatureHeader = { 'x-evolution-signature': webhookSecret };

    // Cria instância na Evolution. Já com webhook inline (reduz race
    // conditions vs criar e depois setWebhook).
    // 🔒 S23 — NÃO passamos mais `number` para a Evolution: a integração
    // WHATSAPP-BAILEYS não usa pairing code por default; o QR Code é o fluxo
    // principal. O número virá automaticamente do webhook ao escanear.
    const result = await this.evolution.createInstance({
      instanceName: session.sessionName,
      webhookUrl,
      webhookSignatureHeader: signatureHeader,
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
