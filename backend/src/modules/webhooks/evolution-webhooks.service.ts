import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WhatsappSessionsService } from '../whatsapp-sessions/whatsapp-sessions.service';

/**
 * 🔒 EvolutionWebhooksService — processa eventos de webhook recebidos da
 * Evolution API e atualiza o estado das sessões no banco.
 *
 * A Evolution POSTa para /webhooks/evolution com body:
 *   {
 *     event: 'CONNECTION_UPDATE' | 'QRCODE_UPDATED' | 'MESSAGES_UPSERT' | ...,
 *     instance: <instanceName>,        // sessionName no nosso DB
 *     data: { ... },                    // payload do evento
 *     date: ISO-8601,
 *   }
 *
 * Para cada evento:
 *  - CONNECTION_UPDATE  → atualiza status (open → connected, close → disconnected)
 *  - QRCODE_UPDATED     → sem ação de banco (QR vai via /sessions/:id/qr)
 *  - MESSAGES_UPSERT    → (placeholder) persistir mensagens e disparar conversas
 *  - SEND_MESSAGE       → marca mensagens enviadas como ACK no banco
 *  - demais             → log estruturado para debug
 *
 * O controller valida a assinatura (secret por instância) antes de chamar
 * este service — aqui assumimos que o evento já é autêntico.
 */
@Injectable()
export class EvolutionWebhooksService {
  private readonly logger = new Logger(EvolutionWebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionsService: WhatsappSessionsService,
  ) {}

  /**
   * Processa um evento validado da Evolution API.
   * `raw` é o payload JSON cru (para logging com data completa).
   * Extraímos `instance`/`event`/`data` que sempre estão presentes.
   */
  async handleEvent(raw: {
    event?: string;
    instance?: string;
    data?: unknown;
    date?: string;
  }): Promise<{ ok: true }> {
    const event = raw?.event;
    const instanceName = raw?.instance;
    if (!event || !instanceName) {
      this.logger.warn(`Webhook Evolution malformed: event=${event} instance=${instanceName}`);
      return { ok: true };
    }

    const session = await this.sessionsService.findBySessionName(instanceName);
    if (!session) {
      // Log nível info (não warn): durante setup é comum receber webhook
      // de instância criada em outro ambiente (evolution compartilhada).
      this.logger.log(`Webhook Evolution: instância "${instanceName}" não cadastrada no DB — ignorando`);
      return { ok: true };
    }

    this.logger.debug(
      `[${event}] session=${session.id} tenant=${session.tenantId} state=${session.status}`,
    );

    switch (event) {
      case 'CONNECTION_UPDATE':
        await this.onConnectionUpdate(session.id, raw.data);
        break;
      case 'QRCODE_UPDATED':
        // Não persistimos QR no banco — frontend busca sob demanda.
        // Apenas descamos lastSeen.
        await this.sessionsService.updateStatus(session.id, session.status, {
          lastSeen: new Date(),
        });
        break;
      case 'APPLICATION_STARTUP':
        // A Evolution reiniciou e a instância subiu — basta atualizar
        // lastSeen. Status de conexão virá em CONNECTION_UPDATE separado.
        await this.sessionsService.updateStatus(session.id, session.status, {
          lastSeen: new Date(),
        });
        break;
      case 'MESSAGES_UPSERT':
      case 'MESSAGES_UPDATE':
      case 'MESSAGES_DELETE':
      case 'SEND_MESSAGE':
        // 🔌 TODO: persistir mensagens/conversas quando o módulo de
        // conversas estiver completo. Por enquanto log estruturado.
        this.logger.log(
          `[${event}] message event para sessão ${session.id} — persistência de mensagens pendente`,
        );
        break;
      case 'CONTACTS_UPSERT':
      case 'PRESENCE_UPDATE':
        // informações auxiliares — podemos enriquecer contatos no futuro.
        this.logger.debug(`[${event}] auxiliar event, sem ação persistida`);
        break;
      default:
        this.logger.debug(`[${event}] evento desconhecido — ignorado`);
    }

    return { ok: true };
  }

  /**
   * CONNECTION_UPDATE — atualiza status da sessão refletindo a conexão
   * real do WhatsApp na Evolution.
   *
   * data pode conter:
   *   { state: 'open' | 'close' | 'connecting' | ..., account: { ... } }
   * Em alguns fluxos o estado é `status` em vez de `state` — aceitamos ambos.
   */
  private async onConnectionUpdate(sessionId: string, data: unknown) {
    if (typeof data !== 'object' || data === null) return;
    const d = data as Record<string, unknown>;
    const state = (d.state ?? d.status) as string | undefined;
    if (!state) return;

    // phone: alguns fluxos trazem em data.wid.user ou data.user
    const phone =
      ((d.wid as Record<string, unknown> | undefined)?.user as string | undefined) ??
      (d.user as string | undefined);

    switch (state.toLowerCase()) {
      case 'open':
      case 'connected':
        await this.sessionsService.markConnected(sessionId, phone);
        this.logger.log(`session ${sessionId} → connected (phone=${phone ?? '-'})`);
        break;
      case 'close':
      case 'disconnected':
      case 'logging_out':
        await this.sessionsService.updateStatus(sessionId, 'disconnected');
        this.logger.log(`session ${sessionId} → disconnected`);
        break;
      case 'connecting':
      case 'qr_screen':
        await this.sessionsService.updateStatus(sessionId, 'qrcode_pending');
        break;
      default:
        this.logger.debug(`session ${sessionId}: CONNECTION_UPDATE state="${state}"`);
    }
  }
}
