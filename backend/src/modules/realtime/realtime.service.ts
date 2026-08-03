import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { InstanceStatusResponse } from '../bots/instance-status.service';

/**
 * 📡 RealtimeService — fachada para emitir eventos WebSocket.
 *
 * Métodos tipados para os três canais do projeto:
 *   - emitInstanceStatus(tenantId, status)
 *   - emitBroadcastProgress(tenantId, progress)
 *   - emitBotSessionChange(tenantId, session)
 *
 * Os emitentes são tolerantes a falha (logger debug apenas) — o WS não
 * pode quebrar o fluxo principal se cair.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  constructor(private readonly gateway: RealtimeGateway) {}

  emitInstanceStatus(tenantId: string, payload: InstanceStatusResponse) {
    try {
      this.gateway.server.to(`tenant:${tenantId}`).emit('instance.status', payload);
    } catch (err) {
      this.logger.debug(`emitInstanceStatus falhou: ${(err as Error).message}`);
    }
  }

  emitBroadcastProgress(
    tenantId: string,
    payload: {
      id: string;
      status: string;
      totalContacts: number;
      sent: number;
      pending: number;
      failed: number;
      lastRunAt: string | null;
      updatedAt: string;
    },
  ) {
    try {
      this.gateway.server.to(`tenant:${tenantId}`).emit('broadcast.progress', payload);
    } catch (err) {
      this.logger.debug(`emitBroadcastProgress falhou: ${(err as Error).message}`);
    }
  }

  emitBotSessionChange(
    tenantId: string,
    payload: {
      id: string;
      botId: string;
      contactId: string;
      status: string;
      currentStepOrdem: number | null;
    },
  ) {
    try {
      this.gateway.server.to(`tenant:${tenantId}`).emit('bot.session', payload);
    } catch (err) {
      this.logger.debug(`emitBotSessionChange falhou: ${(err as Error).message}`);
    }
  }
}
