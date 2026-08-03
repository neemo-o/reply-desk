import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * 📡 RealtimeGateway — WebSocket / Socket.IO
 *
 * Auth: client envia JWT no handshake (`auth.token` ou `Authorization` header).
 * Se válido, o server emite `ready` e aceita `subscribe` para entrar no room
 * do tenant (tenant:<tenantId>).
 *
 * Eventos emitidos pelo server (rooms = tenantId):
 *   instance.status    — payload { status, sessions[], updatedAt }
 *   broadcast.progress — payload { id, status, sent, pending, failed, totalContacts }
 *   bot.session        — payload { id, status, botId, contactId, currentStepOrdem }
 */
@WebSocketGateway({
  cors: { origin: true, credentials: true },
  path: '/realtime',
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit() {
    this.logger.log('RealtimeGateway inicializado em /realtime');
  }

  handleConnection(socket: Socket) {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '');
      if (!token) {
        this.logger.warn(`Socket ${socket.id}: sem token — desconectando`);
        socket.emit('error', { message: 'Token ausente' });
        socket.disconnect(true);
        return;
      }
      const payload = this.jwt.verify<{ sub: string; email: string }>(token, {
        algorithms: ['HS256'],
      });
      (socket.data as { userId: string }).userId = payload.sub;
    } catch (err) {
      this.logger.warn(`Socket ${socket.id}: JWT inválido — ${(err as Error).message}`);
      socket.emit('error', { message: 'Token inválido' });
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket) {
    void socket;
    // Socket.IO limpa rooms automaticamente no disconnect.
  }

  /**
   * subscribe { tenantId }
   * Verifica se o user tem membership ativa no tenant e adiciona ao room.
   */
  @SubscribeMessage('subscribe')
  async onSubscribe(
    @MessageBody() data: { tenantId?: string },
    @ConnectedSocket() socket: Socket,
  ) {
    if (!data?.tenantId) {
      throw new UnauthorizedException('tenantId é obrigatório');
    }
    const userId = (socket.data as { userId?: string }).userId;
    if (!userId) {
      throw new UnauthorizedException('Não autenticado');
    }
    const membership = await this.prisma.tenantUser.findFirst({
      where: { tenantId: data.tenantId, userId, status: 'active' },
      select: { id: true },
    });
    if (!membership) {
      throw new UnauthorizedException('Sem permissão neste tenant');
    }
    await socket.join(`tenant:${data.tenantId}`);
    socket.emit('ready', { tenantId: data.tenantId });
    return { ok: true, room: `tenant:${data.tenantId}` };
  }
}
