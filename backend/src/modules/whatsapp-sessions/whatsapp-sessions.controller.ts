import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WhatsappSessionsService } from './whatsapp-sessions.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { SESSION_QUEUE } from '../queue/queue.module';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

class ListSessionsQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
}

/**
 * 🔒 Endpoints de gestão de sessões WhatsApp.
 *
 * Todos autenticados via JWT (JwtAuthGuard global) + TenantGuard (valida
 * que o user pertence ao tenant e injeta tenantId). Tenant é separador
 * de segurança: cada request só opera sobre sessões do tenant autenticado.
 *
 * A Evolution API é tratada como serviço externo. O banco nunca guarda
 * QR Code nem credenciais — só instanceName + status + metadata.
 *
 * Rotas (`api/v1` prefix global):
 *   POST   /whatsapp/sessions                  cria sessão + enfileira conexão
 *   GET    /whatsapp/sessions                  lista sessões do tenant
 *   GET    /whatsapp/sessions/:id/qr          busca QR atual na Evolution
 *   GET    /whatsapp/sessions/:id              detalhe de uma sessão
 *   POST   /whatsapp/sessions/:id/reconnect   reconecta sessão mantendo instância
 *   POST   /whatsapp/sessions/:id/logout      desconecta sessão mantendo instância
 *   DELETE /whatsapp/sessions/:id              deleta sessão E instância permanentemente
 *
 * 🔒 M6 — SubscriptionGuard agora é global (APP_GUARD em AppModule).
 */
@UseGuards(TenantGuard)
@Controller('whatsapp/sessions')
export class WhatsappSessionsController {
  constructor(
    private readonly sessionsService: WhatsappSessionsService,
    @InjectQueue(SESSION_QUEUE) private readonly sessionQueue: Queue,
  ) {}

  /**
   * Cria a sessão no banco e enfileira job BullMQ `connect-session`.
   * O worker no processo separado chama EvolutionService.createInstance +
   * EvolutionService.connect para iniciar o QR.
   */
  @Post()
  async create(@CurrentTenant() tenantId: string, @Body() dto: CreateSessionDto) {
    const { session, webhookSecret } = await this.sessionsService.create(tenantId, dto);
    // Enfileira job de conexão — worker processa.
    // Passamos webhookSecret no job (não persistente em DB além do hash).
    await this.sessionQueue.add(
      'connect-session',
      { sessionId: session.id, tenantId, webhookSecret },
      {
        jobId: `connect-${session.id}`,
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );
    // Não devolvemos o webhookSecret ao frontend — ele é secreto entre
    // backend e Evolution API.
    return session;
  }

  @Get()
  findAll(@CurrentTenant() tenantId: string, @Query() q: ListSessionsQuery) {
    return this.sessionsService.findAll(tenantId, {
      take: q.take,
      cursor: q.cursor,
    });
  }

  @Get(':id')
  findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.sessionsService.findOne(tenantId, id);
  }

  /**
   * 🪵 Inbox temporário: últimas mensagens recebidas/enviadas nesta sessão.
   * Endpoint principal consumido pela página `/dashboard/whatsapp` para
   * o painel "log temporário de mensagens".
   */
  @Get(':id/inbox')
  getInbox(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query() q: ListSessionsQuery,
  ) {
    return this.sessionsService.findInbox(tenantId, id, {
      take: q.take,
      cursor: q.cursor,
    });
  }

  /**
   * Busca o QR Code atual na Evolution API. O QR é retornado em tempo real
   * e nunca persistido. O frontend polla este endpoint a cada 2-3s durante
   * o fluxo de conexão.
   */
  @Get(':id/qr')
  getQrCode(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.sessionsService.getQrCode(tenantId, id);
  }

  /**
   * Reconecta uma sessão que caiu. Mantém a instância na Evolution,
   * apenas chama /instance/connect/{name}. Não precisa reescanear QR
   * se a Evolution ainda tem as credenciais em /evolution_data.
   */
  @Post(':id/reconnect')
  @HttpCode(HttpStatus.OK)
  reconnect(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.sessionsService.reconnect(tenantId, id);
  }

  /**
   * Logout: encerra a sessão do WhatsApp na Evolution. A instância
   * permanece e pode ser reconectada depois via /reconnect (sem re-
   * escanear QR se a Evolution mantém as credenciais).
   */
  @Post(':id/logout')
  @HttpCode(HttpStatus.OK)
  logout(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.sessionsService.logout(tenantId, id);
  }

  /**
   * ⚠️ Compat: PATCH /:id/disconnect equivale a /:id/logout.
   * Mantemos por retrocompatibilidade com o frontend antigo.
   */
  @Patch(':id/disconnect')
  @HttpCode(HttpStatus.OK)
  disconnect(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.sessionsService.logout(tenantId, id);
  }

  /**
   * Deleta permanentemente a sessão (e a instância na Evolution).
   * As credenciais em /evolution_data são removidas pela Evolution.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.sessionsService.delete(tenantId, id);
  }
}
