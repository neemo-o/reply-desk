import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Request } from 'express';
import { WhatsappSessionsService, ReconnectNeedsRecreateException } from './whatsapp-sessions.service';
import { ContactFilterService } from './contact-filter.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionSettingsDto } from './dto/update-session-settings.dto';
import {
  AddContactToListDto,
  CONTACT_LISTS,
  CreateContactDto,
  type ContactList,
} from './dto/add-contact-to-list.dto';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { SESSION_QUEUE } from '../queue/queue.module';
import { ContactsService } from '../contacts/contacts.service';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

class ListSessionsQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
}

class ListContactsQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) take?: number;
  @IsIn(CONTACT_LISTS)
  list: ContactList;
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
 * 🔒 S23 — Controle por role (RolesGuard + @Roles):
 *   - owner, admin: PODEM criar, listar completo, ver detalhes, reconectar,
 *                   desconectar e excluir sessões. Somente eles gerenciam.
 *   - agent (atendente): PODE SOMENTE listar (versão "safe" — status running
 *                   ou não) e ver status. Não pode criar, reconectar,
 *                   desconectar, excluir, nem ver detalhes sensíveis
 *                   (sessionName, evolutionInstanceId, phone).
 *
 * Rotas (`api/v1` prefix global):
 *   POST   /whatsapp/sessions                  cria sessão [owner,admin] — SEM enfileirar QR
 *   POST   /whatsapp/sessions/:id/connect      enfileira QR [owner,admin] — gate: exige bot
 *   GET    /whatsapp/sessions                  lista sessões (owner/admin=completo; agent=safe)
 *   GET    /whatsapp/sessions/:id              detalhe [owner,admin]; agent=safe
 *   GET    /whatsapp/sessions/:id/qr          busca QR atual na Evolution [owner,admin]
 *   GET    /whatsapp/sessions/:id/inbox        🪵 inbox de mensagens [owner,admin]
 *   GET    /whatsapp/sessions/:id/logs        🪵 logs de conexão [owner,admin]
 *   POST   /whatsapp/sessions/:id/reconnect   reconecta sessão [owner,admin]
 *   POST   /whatsapp/sessions/:id/logout      desconecta e regenera QR [owner,admin]
 *   PATCH  /whatsapp/sessions/:id/disconnect  ⚠️ compat = /logout [owner,admin]
 *   PATCH  /whatsapp/sessions/:id/settings    atualiza config (filtro + bot) [owner,admin]
 *   GET    /whatsapp/sessions/:id/settings    lê config atual [owner,admin]
 *   GET    /whatsapp/sessions/:id/settings/contacts?list=whitelist|blacklist
 *                                              lista contatos da whitelist/blacklist [owner,admin]
 *   POST   /whatsapp/sessions/:id/settings/contacts
 *                                              adiciona contato a uma lista [owner,admin]
 *   DELETE /whatsapp/sessions/:id/settings/contacts/:itemId
 *                                              remove contato da lista [owner,admin]
 *   POST   /contacts                           cria/upsert contato manual (por número) [owner,admin]
 *   DELETE /whatsapp/sessions/:id              deleta permanente [owner,admin]
 *
 * 🔒 M6 — SubscriptionGuard agora é global (APP_GUARD em AppModule).
 */
@UseGuards(TenantGuard, RolesGuard)
@Controller('whatsapp/sessions')
export class WhatsappSessionsController {
  constructor(
    private readonly sessionsService: WhatsappSessionsService,
    private readonly contactFilter: ContactFilterService,
    private readonly contactsService: ContactsService,
    @InjectQueue(SESSION_QUEUE) private readonly sessionQueue: Queue,
  ) {}

  /**
   * Helper: extrai a role do request. TenantGuard popula `request.user.role`
   * a partir do cache Redis (ou faz lookup no DB).
   */
  private getRole(req: Request): string {
    return (req.user as { role?: string } | undefined)?.role ?? '';
  }

  /**
   * Cria a sessão no banco + SessionSettings. NÃO enfileira conexão —
   * o frontend chama POST /:id/connect depois (botão "Conectar / Gerar QR").
   *
   * 🔒 S24 — O DTO exige `activeBotId`. O service valida que o bot
   * está publicado e pertence ao tenant; se não, BadRequest com mensagem
   * clara explicando o que falta (frontend mostra no formulário).
   */
  @Post()
  @Roles('owner', 'admin')
  async create(@CurrentTenant() tenantId: string, @Body() dto: CreateSessionDto) {
    const { session } = await this.sessionsService.create(tenantId, dto);
    // 🔒 S24 — não enfileiramos o connect-session automaticamente; o owner
    // vê a sessão criada (status='connecting' com settings prontos) e
    // chama /:id/connect quando quiser o QR.
    return session;
  }

  /**
   * 🔒 S24 — Gate de conexão (botão "Gerar QR Code" na UI).
   *
   * Só enfileira `connect-session` se a sessão tiver:
   *  - bot ativo (SessionSettings.activeBotId) — se não tiver, BadRequest.
   *  - bot referenciado continua publicado — revalida para evitar race.
   *
   * Se a config não estiver OK, devolve 400 com a razão; o frontend
   * desabilita o botão quando lista whitelist vazia + modo=blacklist
   * (mostrar mensagem "Adicione ao menos um contato à blacklist") ou
   * sem bot (mostrar "Crie e selecione um bot publicado").
   */
  @Post(':id/connect')
  @HttpCode(HttpStatus.OK)
  @Roles('owner', 'admin')
  async connect(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const role = this.getRole(req);
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException('Apenas owner/admin podem conectar sessões');
    }

    // O service revalida bot publicado + retorna o webhook secret plain
    // (precisamos dele pra passar ao worker).
    const { session, webhookSecret } = await this.sessionsService.startConnect(tenantId, id);

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

    return session;
  }

  /**
   * Lista as sessões do tenant.
   *
   * 🔒 S23 — owner/admin recebem detalhes completos (incluindo sessionName,
   * evolutionInstanceId, phone). Agentes recebem versão "safe": só name,
   * status (running/not running) e lastSeen.
   */
  @Get()
  async findAll(@CurrentTenant() tenantId: string, @Query() q: ListSessionsQuery, @Req() req: Request) {
    const role = this.getRole(req);
    const opts = { take: q.take, cursor: q.cursor };
    if (role === 'owner' || role === 'admin') {
      return this.sessionsService.findAll(tenantId, opts);
    }
    // agent (e qualquer outro) → versão safe, sem dados sensíveis
    return this.sessionsService.findAllSafe(tenantId, opts);
  }

  /**
   * Detalhe de uma sessão.
   * 🔒 S23 — owner/admin recebem detalhes completos; agent recebe versão safe.
   */
  @Get(':id')
  async findOne(@CurrentTenant() tenantId: string, @Param('id') id: string, @Req() req: Request) {
    const role = this.getRole(req);
    if (role === 'owner' || role === 'admin') {
      return this.sessionsService.findOne(tenantId, id);
    }
    return this.sessionsService.findOneSafe(tenantId, id);
  }

  /**
   * 🪵 Inbox temporário: últimas mensagens recebidas/enviadas nesta sessão.
   * 🔒 S23 — Agora só é relevante para owner/admin (agentes não têm detalhes).
   * Reservado para visão administrativa; a página de detalhes usa /logs.
   */
  @Get(':id/inbox')
  @Roles('owner', 'admin')
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
   * 🪵 S23 — Logs de CONEXÃO da sessão. Substitui o uso do inbox como "log
   * temporário" na página de detalhes. Retorna eventos de conexão
   * (qrcode_pending, connected, disconnected, etc.) ordenados por data desc.
   *
   * 🔒 owner/admin apenas — agentes não têm acesso aos detalhes da sessão.
   */
  @Get(':id/logs')
  @Roles('owner', 'admin')
  getLogs(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query() q: ListSessionsQuery,
  ) {
    return this.sessionsService.findEvents(tenantId, id, {
      take: q.take,
      cursor: q.cursor,
    });
  }

  /**
   * Busca o QR Code atual na Evolution API. O QR é retornado em tempo real
   * e nunca persistido. O frontend polla este endpoint a cada 2-3s durante
   * o fluxo de conexão.
   *
   * 🔒 S23 — owner/admin apenas. Agentes não têm why preciso de QR (não
   * podem reconectar). Edge de role: subscription guard trata isso também.
   */
  @Get(':id/qr')
  @Roles('owner', 'admin')
  getQrCode(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.sessionsService.getQrCode(tenantId, id);
  }

  /**
   * 🔒 S23 — Reconecta uma sessão. Mantém a instância na Evolution se ela
   * ainda existe, apenas chama /instance/connect/{name} para gerar um QR
   * novo. Se a instância foi deletada na Evolution, o service lança
   * `ReconnectNeedsRecreateException` com um novo webhook secret plain —
   * aqui detectamos e reenfileiramos o job `connect-session`.
   */
  @Post(':id/reconnect')
  @HttpCode(HttpStatus.OK)
  @Roles('owner', 'admin')
  async reconnect(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    try {
      return await this.sessionsService.reconnect(tenantId, id);
    } catch (err) {
      if (err instanceof ReconnectNeedsRecreateException) {
        // Reenfileira o job connect-session com o novo webhook secret plain.
        await this.sessionQueue.add(
          'connect-session',
          { sessionId: id, tenantId, webhookSecret: err.webhookSecret },
          {
            jobId: `reconnect-${id}-${Date.now()}`,
            removeOnComplete: 100,
            removeOnFail: 200,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          },
        );
        return { status: 'connecting' };
      }
      throw err;
    }
  }

  /**
   * 🔒 S23 — Logout (botão "Desconectar"): NÃO encerra mais a instância na
   * Evolution. Em vez disso, chama `restart` na Evolution para forçar a
   * regeneração do QR Code. O status vira `qrcode_pending` e o phone é
   * zerado (próximo QR pode ser outro número).
   *
   * O frontend automaticamente começa a pollar o QR novamente porque
   * status == qrcode_pending.
   */
  @Post(':id/logout')
  @HttpCode(HttpStatus.OK)
  @Roles('owner', 'admin')
  logout(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.sessionsService.logout(tenantId, id);
  }

  /**
   * ⚠️ Compat: PATCH /:id/disconnect equivale a /:id/logout.
   * Mantemos por retrocompatibilidade com o frontend antigo.
   */
  @Patch(':id/disconnect')
  @HttpCode(HttpStatus.OK)
  @Roles('owner', 'admin')
  disconnect(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.sessionsService.logout(tenantId, id);
  }

  /**
   * Deleta permanentemente a sessão (e a instância na Evolution).
   * As credenciais em /evolution_data são removidas pela Evolution.
   *
   * 🔒 S23 — owner/admin apenas.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles('owner', 'admin')
  remove(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.sessionsService.delete(tenantId, id);
  }

  // ======================================================================
  // 🔒 S24 — Endpoints de configuração da sessão (filtro + bot + listas)
  // ======================================================================

  /**
   * GET /whatsapp/sessions/:id/settings
   * Retorna o SessionSettings completo. Usado pela UI para preencher
   * o formulário de configurações da sessão.
   */
  @Get(':id/settings')
  @Roles('owner', 'admin')
  getSettings(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return this.sessionsService.getSettings(tenantId, id);
  }

  /**
   * PATCH /whatsapp/sessions/:id/settings
   * Atualiza configurações (filtro de contatos + bot ativo). NÃO
   * reconecta a sessão — o filtro passa a valer no próximo inbound.
   */
  @Patch(':id/settings')
  @Roles('owner', 'admin')
  updateSettings(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSessionSettingsDto,
  ) {
    return this.sessionsService.updateSettings(tenantId, id, dto);
  }

  /**
   * GET /whatsapp/sessions/:id/settings/contacts?list=whitelist|blacklist
   * Lista contatos de uma das listas da sessão (paginada por cursor).
   */
  @Get(':id/settings/contacts')
  @Roles('owner', 'admin')
  listContacts(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Query() q: ListContactsQuery,
  ) {
    return this.contactFilter.listContacts(tenantId, id, q.list, {
      take: q.take,
      cursor: q.cursor,
    });
  }

  /**
   * POST /whatsapp/sessions/:id/settings/contacts
   * Adiciona um contato a uma lista (whitelist ou blacklist). O contato
   * precisa existir e ser do mesmo tenant — criar via POST /contacts se
   * não existir.
   */
  @Post(':id/settings/contacts')
  @Roles('owner', 'admin')
  addContactToList(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body() dto: AddContactToListDto,
  ) {
    return this.contactFilter.addContact(tenantId, id, dto);
  }

  /**
   * DELETE /whatsapp/sessions/:id/settings/contacts/:itemId
   * Remove um contato de uma lista. Não deleta o contato em si.
   */
  @Delete(':id/settings/contacts/:itemId')
  @HttpCode(HttpStatus.OK)
  @Roles('owner', 'admin')
  removeContactFromList(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.contactFilter.removeContact(tenantId, id, itemId);
  }

  /**
   * POST /contacts
   * Cria (ou faz upsert de) um contato a partir de um número. Usado
   * quando o owner quer adicionar à blacklist alguém que AINDA NÃO
   * mandou mensagem — sem esse endpoint o contato só existe depois
   * da primeira mensagem (criado no webhook).
   */
  @Post('contacts')
  @Roles('owner', 'admin')
  createContact(@CurrentTenant() tenantId: string, @Body() dto: CreateContactDto) {
    return this.contactsService.upsertByPhone(tenantId, dto.phone, {
      name: dto.name,
      notes: dto.notes,
    });
  }
}
