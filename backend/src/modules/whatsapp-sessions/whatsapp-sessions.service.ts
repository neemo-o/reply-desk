import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EvolutionService } from '../../common/evolution/evolution.service';
import { PlanLimitsService } from '../subscriptions/plan-limits.service';
import { isUuid } from '../../common/utils/security';
import { ConfigService } from '@nestjs/config';
import {
  CreateSessionDto,
  normalizeContactFilterMode,
  type ContactFilterMode,
} from './dto/create-session.dto';
import { RealtimeService } from '../realtime/realtime.service';
import { RedisService } from '../../common/redis/redis.service';

@Injectable()
export class WhatsappSessionsService {
  private readonly logger = new Logger(WhatsappSessionsService.name);

  // ─── Redis QR cache keys ──────────────────────────────────────────
  // Formato: qr:<sessionId>  →  JSON { qrcode, code?, pairingCode?, generatedAt }
  // TTL igual a qrCacheMaxAgeMs (5 min). Compartilhado entre HTTP e worker.
  private readonly QR_CACHE_PREFIX = 'qr:';
  private readonly QR_CACHE_TTL_S = 300; // 5 min

  // ─── Redis connect-lock keys ──────────────────────────────────────
  // Previne race condition em startConnect() quando chamado em paralelo.
  // SET NX EX garante que só uma requisição gera o webhook secret por vez.
  private readonly CONNECT_LOCK_PREFIX = 'connect-lock:';
  private readonly CONNECT_LOCK_TTL_S = 10; // 10s — suficiente para o argon2.hash

  private readonly qrMaxAttempts: number;
  private readonly qrDebounceMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitsService,
    private readonly evolution: EvolutionService,
    config: ConfigService,
    @Inject(forwardRef(() => RealtimeService))
    private readonly realtime: RealtimeService,
    private readonly redis: RedisService,
  ) {
    this.qrMaxAttempts = Math.max(1, parseInt(config.get<string>('evolution.qrMaxAttempts') ?? '10', 10) || 10);
    this.qrDebounceMs = Math.max(500, parseInt(config.get<string>('evolution.qrDebounceMs') ?? '3000', 10) || 3000);
  }

  // ─── Redis QR cache helpers ────────────────────────────────────────

  private qrKey(sessionId: string): string {
    return `${this.QR_CACHE_PREFIX}${sessionId}`;
  }

  private async getQrCache(sessionId: string): Promise<{ qrcode: string; code?: string; pairingCode?: string; generatedAt: number } | null> {
    try {
      const raw = await this.redis.get(this.qrKey(sessionId));
      if (!raw) return null;
      return JSON.parse(raw) as { qrcode: string; code?: string; pairingCode?: string; generatedAt: number };
    } catch {
      return null;
    }
  }

  private async setQrCache(sessionId: string, value: { qrcode: string; code?: string; pairingCode?: string; generatedAt: number }): Promise<void> {
    try {
      await this.redis.set(this.qrKey(sessionId), JSON.stringify(value), 'EX', this.QR_CACHE_TTL_S);
    } catch (err) {
      this.logger.warn(`setQrCache(${sessionId}) falhou: ${(err as Error).message}`);
    }
  }

  private async deleteQrCache(sessionId: string): Promise<void> {
    try {
      await this.redis.del(this.qrKey(sessionId));
    } catch {
      // silencia — não crítico
    }
  }

  // ─── Redis connect-lock helpers ────────────────────────────────────

  private connectLockKey(sessionId: string): string {
    return `${this.CONNECT_LOCK_PREFIX}${sessionId}`;
  }

  /** Tenta adquirir o lock de conexão. Retorna true se adquiriu, false se já havia outro. */
  private async acquireConnectLock(sessionId: string): Promise<boolean> {
    try {
      const result = await this.redis.set(
        this.connectLockKey(sessionId),
        '1',
        'EX',
        this.CONNECT_LOCK_TTL_S,
        'NX',
      );
      return result === 'OK';
    } catch (err) {
      // Se o Redis falhar, deixa passar (degraded mode) para não bloquear o fluxo.
      this.logger.warn(`acquireConnectLock(${sessionId}) falhou: ${(err as Error).message} — seguindo sem lock`);
      return true;
    }
  }

  private async releaseConnectLock(sessionId: string): Promise<void> {
    try {
      await this.redis.del(this.connectLockKey(sessionId));
    } catch {
      // silencia
    }
  }

  // ─── Helpers internos ──────────────────────────────────────────────

  private buildInstanceName(tenantId: string): string {
    const tenantShort = tenantId.replace(/-/g, '').slice(0, 8).toLowerCase();
    const rand = randomBytes(6).toString('hex');
    return `rd-${tenantShort}-${rand}`;
  }

  private async generateWebhookSecret(): Promise<{ plain: string; hash: string }> {
    const plain = randomBytes(32).toString('hex');
    const hash = await argon2.hash(plain);
    return { plain, hash };
  }

  // ─── CRUD ─────────────────────────────────────────────────────────

  async create(tenantId: string, dto: CreateSessionDto) {
    await this.planLimits.assertCanCreateSession(tenantId);

    const existing = await this.prisma.whatsappSession.findFirst({
      where: { tenantId, name: dto.name },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Já existe uma sessão com esse nome neste tenant');
    }

    await this.assertBotReadyForSession(tenantId, dto.activeBotId);

    const sessionName = this.buildInstanceName(tenantId);
    const webhook = await this.generateWebhookSecret();

    const session = await this.prisma.whatsappSession.create({
      data: {
        tenantId,
        name: dto.name,
        phone: null,
        sessionName,
        status: 'connecting',
        webhookSecretHash: webhook.hash,
        settings: {
          create: {
            contactFilterMode: dto.contactFilterMode ?? 'none',
            activeBotId: dto.activeBotId,
          },
        },
      },
      select: {
        id: true,
        tenantId: true,
        name: true,
        phone: true,
        sessionName: true,
        status: true,
        lastSeen: true,
        createdAt: true,
        settings: {
          select: {
            contactFilterMode: true,
            activeBotId: true,
          },
        },
      },
    });

    await this.logEvent(session.id, tenantId, 'created', {
      message: `Sessão "${dto.name}" criada` +
        (session.settings ? ` (bot=${session.settings.activeBotId ?? '-'})` : ''),
    });

    return { session, webhookSecret: webhook.plain };
  }

  private async assertBotReadyForSession(
    tenantId: string,
    activeBotId: string,
  ): Promise<void> {
    const bot = await this.prisma.bot.findFirst({
      where: { id: activeBotId, tenantId },
      select: { id: true, status: true },
    });
    if (!bot) {
      throw new BadRequestException('Bot não encontrado neste tenant');
    }
    if (bot.status !== 'active' && bot.status !== 'testing') {
      throw new BadRequestException(
        `Bot não está publicado nem em teste (status atual: ${bot.status}). ` +
          `Ative o bot (ou coloque em testing) antes de criar uma sessão.`,
      );
    }
  }

  async updateSettings(
    tenantId: string,
    sessionId: string,
    dto: {
      contactFilterMode?: ContactFilterMode;
      activeBotId?: string | null;
      webhookUrl?: string;
    },
  ): Promise<{
    id: string;
    contactFilterMode: string;
    activeBotId: string | null;
  }> {
    const session = await this.prisma.whatsappSession.findFirst({
      where: { id: sessionId, tenantId },
      select: { id: true, settings: { select: { id: true } } },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');

    let nextActiveBotId: string | null | undefined = dto.activeBotId;
    if (dto.activeBotId !== undefined && dto.activeBotId !== null) {
      await this.assertBotReadyForSession(tenantId, dto.activeBotId);
    }

    const updated = await this.prisma.sessionSettings.upsert({
      where: { sessionId: session.id },
      update: {
        ...(dto.contactFilterMode !== undefined ? { contactFilterMode: dto.contactFilterMode } : {}),
        ...(nextActiveBotId !== undefined ? { activeBotId: nextActiveBotId } : {}),
        ...(dto.webhookUrl !== undefined ? { webhookUrl: dto.webhookUrl } : {}),
      },
      create: {
        sessionId: session.id,
        contactFilterMode: dto.contactFilterMode ?? 'none',
        activeBotId: nextActiveBotId ?? null,
      },
      select: {
        id: true,
        contactFilterMode: true,
        activeBotId: true,
      },
    });

    return {
      ...updated,
      contactFilterMode: normalizeContactFilterMode(updated.contactFilterMode),
    };
  }

  async getSettings(tenantId: string, sessionId: string) {
    const session = await this.prisma.whatsappSession.findFirst({
      where: { id: sessionId, tenantId },
      select: { id: true },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');

    return this.prisma.sessionSettings.upsert({
      where: { sessionId },
      update: {},
      create: { sessionId },
      select: {
        id: true,
        contactFilterMode: true,
        activeBotId: true,
        webhookUrl: true,
      },
    }).then((s) => ({
      ...s,
      contactFilterMode: normalizeContactFilterMode(s.contactFilterMode),
    }));
  }

  /**
   * Gate de conexão. Usa lock Redis para evitar que duas chamadas paralelas
   * gerem webhooks secrets diferentes — o segundo sobrescreveria o hash no
   * banco, tornando todos os webhooks da instância inválidos e deixando a
   * sessão "surda" a CONNECTION_UPDATE.
   */
  async startConnect(
    tenantId: string,
    sessionId: string,
  ): Promise<{
    session: { id: string; status: string };
    webhookSecret: string;
  }> {
    const session = await this.prisma.whatsappSession.findFirst({
      where: { id: sessionId, tenantId },
      select: {
        id: true,
        status: true,
        webhookSecretHash: true,
        settings: {
          select: { activeBotId: true },
        },
      },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');

    if (!session.settings?.activeBotId) {
      throw new BadRequestException(
        'Esta sessão não tem um bot ativo. Selecione um bot publicado nas configurações antes de gerar o QR Code.',
      );
    }

    const bot = await this.prisma.bot.findFirst({
      where: {
        id: session.settings.activeBotId,
        tenantId,
      },
      select: { id: true, status: true },
    });
    if (!bot) {
      throw new BadRequestException(
        'O bot vinculado a esta sessão foi excluído. Selecione outro bot antes de gerar o QR Code.',
      );
    }
    if (bot.status !== 'active' && bot.status !== 'testing') {
      throw new BadRequestException(
        `O bot vinculado a esta sessão não está mais ativo nem em testing (status: ${bot.status}). ` +
          `Ative o bot (ou coloque em testing) antes de gerar o QR Code.`,
      );
    }

    if (!session.webhookSecretHash) {
      throw new BadRequestException('Sessão sem webhook secret configurado (estado inválido)');
    }

    // FIX 2 — Lock Redis: garante que apenas uma chamada concorrente a
    // startConnect() gera/persiste o webhook secret. Sem lock, duas
    // requisições paralelas (duplo clique, retry de rede) geravam secrets
    // distintos; o segundo sobrescrevia o hash no banco, deixando os
    // webhooks da instância com assinatura inválida e a sessão surda a
    // CONNECTION_UPDATE.
    const lockAcquired = await this.acquireConnectLock(session.id);
    if (!lockAcquired) {
      // Outra requisição está gerando o secret agora — devolve o estado
      // atual sem criar um segundo secret concorrente.
      this.logger.warn(`startConnect(${session.id}): lock ocupado — requisição paralela ignorada`);
      return { session: { id: session.id, status: session.status }, webhookSecret: '' };
    }

    try {
      const { plain } = await this.generateWebhookSecret();
      await this.prisma.whatsappSession.update({
        where: { id: session.id },
        data: { webhookSecretHash: await argon2.hash(plain) },
      });

      await this.resetQrAttempts(session.id);

      return { session: { id: session.id, status: session.status }, webhookSecret: plain };
    } finally {
      await this.releaseConnectLock(session.id);
    }
  }

  async findAll(tenantId: string, opts: { take?: number; cursor?: string } = {}) {
    const take = Math.min(Math.max(opts.take ?? 50, 1), 100);
    const sessions = await this.prisma.whatsappSession.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        phone: true,
        profileName: true,
        sessionName: true,
        evolutionInstanceId: true,
        status: true,
        qrAttempts: true,
        lastSeen: true,
        createdAt: true,
        settings: {
          select: {
            contactFilterMode: true,
            activeBotId: true,
          },
        },
      },
    });

    // FIX 7 — sync de detalhes é feito em background (fire-and-forget).
    // Antes o findAll aguardava todas as chamadas à Evolution antes de
    // responder — se houvesse N sessões conectadas sem número, N requests
    // à Evolution bloqueavam a listagem inteira.
    for (const session of sessions) {
      if (session.status === 'connected' && (!session.phone || !session.profileName)) {
        void this.syncConnectedDetails(session.id, session.sessionName).catch(() => {
          // silencia — fallback já está no próximo findAll
        });
      }
    }

    return sessions;
  }

  private async syncConnectedDetails(
    sessionId: string,
    sessionName: string,
  ): Promise<{ phone?: string | null; profileName?: string | null }> {
    try {
      const instance = await this.evolution.fetchInstance(sessionName);
      const phone = this.extractEvolutionPhone(instance);
      let profileName = this.extractEvolutionProfileName(instance);

      if (!profileName && phone) {
        profileName = await this.fetchProfileName(sessionName, phone);
      }

      const updates: { phone?: string; profileName?: string } = {};
      if (phone) updates.phone = phone;
      if (profileName) updates.profileName = profileName;
      if (Object.keys(updates).length === 0) return { phone: null, profileName: null };
      await this.prisma.whatsappSession.update({
        where: { id: sessionId },
        data: updates,
      });
      this.logger.log(
        `session ${sessionId}: detalhes sincronizados da Evolution ` +
        `(phone=${updates.phone ?? '-'} profileName=${updates.profileName ?? '-'})`,
      );
      return { phone: updates.phone ?? null, profileName: updates.profileName ?? null };
    } catch (err) {
      this.logger.debug(
        `session ${sessionId}: não foi possível sincronizar detalhes da Evolution: ${(err as Error).message}`,
      );
      return { phone: null, profileName: null };
    }
  }

  async syncProfileName(
    sessionId: string,
    sessionName: string,
    phone: string,
  ): Promise<string | null> {
    try {
      const profileName = await this.fetchProfileName(sessionName, phone);
      if (!profileName) return null;
      await this.prisma.whatsappSession.update({
        where: { id: sessionId },
        data: { profileName },
      });
      this.logger.log(
        `session ${sessionId}: profileName sincronizado via fetchProfile ` +
        `(${phone} → "${profileName}")`,
      );
      return profileName;
    } catch (err) {
      this.logger.debug(
        `session ${sessionId}: falha ao sincronizar profileName via fetchProfile: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async fetchProfileName(
    sessionName: string,
    phone: string,
  ): Promise<string | null> {
    try {
      const profile = await this.evolution.fetchProfile(sessionName, phone);
      const record = (profile ?? {}) as Record<string, unknown>;
      const candidates: (string | null | undefined)[] = [
        typeof record.name === 'string' ? record.name : undefined,
        typeof record.pushName === 'string' ? record.pushName : undefined,
        typeof record.businessName === 'string' ? record.businessName : undefined,
      ];
      const businessProfile = record.businessProfile as
        | Record<string, unknown>
        | undefined;
      if (businessProfile && typeof businessProfile.name === 'string') {
        candidates.push(businessProfile.name);
      }
      for (const c of candidates) {
        if (typeof c === 'string' && c.trim().length > 0) {
          return c.trim();
        }
      }
      this.logger.debug(
        `fetchProfileName(${sessionName}, ${phone}): Evolution não devolveu ` +
        `nome. Payload=${JSON.stringify(profile).slice(0, 600)}`,
      );
      return null;
    } catch (err) {
      this.logger.debug(
        `fetchProfileName(${sessionName}, ${phone}) falhou: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private extractEvolutionProfileName(value: unknown, depth = 0): string | null {
    if (depth > 5 || value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const name = this.extractEvolutionProfileName(item, depth + 1);
        if (name) return name;
      }
      return null;
    }
    if (typeof value !== 'object') return null;

    const record = value as Record<string, unknown>;
    const nameKeys = ['profileName', 'profile_name'];
    for (const key of nameKeys) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }

    for (const childKey of ['instance', 'data', 'connection', 'profile']) {
      const name = this.extractEvolutionProfileName(record[childKey], depth + 1);
      if (name) return name;
    }
    return null;
  }

  private extractEvolutionPhone(value: unknown, depth = 0): string | null {
    if (depth > 5 || value === null || value === undefined) return null;
    if (Array.isArray(value)) {
      for (const item of value) {
        const phone = this.extractEvolutionPhone(item, depth + 1);
        if (phone) return phone;
      }
      return null;
    }
    if (typeof value !== 'object') return null;

    const record = value as Record<string, unknown>;
    const phoneKeys = ['ownerJid', 'owner', 'phone', 'number', 'user'];
    for (const key of phoneKeys) {
      const candidate = record[key];
      if (typeof candidate !== 'string') continue;
      const digits = candidate.split(/[:@]/)[0].replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 15) return digits;
    }

    for (const childKey of ['instance', 'data', 'connection', 'profile', 'wid', 'phoneNumber']) {
      const phone = this.extractEvolutionPhone(record[childKey], depth + 1);
      if (phone) return phone;
    }
    return null;
  }

  findAllSafe(tenantId: string, opts: { take?: number; cursor?: string } = {}) {
    const take = Math.min(Math.max(opts.take ?? 50, 1), 100);
    return this.prisma.whatsappSession.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        status: true,
        lastSeen: true,
        settings: { select: { contactFilterMode: true } },
      },
    });
  }

  async findOne(tenantId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException('Sessão não encontrada');
    const session = await this.prisma.whatsappSession.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        phone: true,
        profileName: true,
        sessionName: true,
        evolutionInstanceId: true,
        status: true,
        qrAttempts: true,
        qrLastGeneratedAt: true,
        lastSeen: true,
        createdAt: true,
        updatedAt: true,
        settings: {
          select: {
            webhookUrl: true,
            contactFilterMode: true,
            activeBotId: true,
          },
        },
      },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return session;
  }

  async findOneSafe(tenantId: string, id: string) {
    if (!isUuid(id)) throw new NotFoundException('Sessão não encontrada');
    const session = await this.prisma.whatsappSession.findFirst({
      where: { id, tenantId },
      select: {
        id: true,
        name: true,
        status: true,
        lastSeen: true,
        createdAt: true,
      },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return session;
  }

  async findInbox(
    tenantId: string,
    sessionId: string,
    opts: { take?: number; cursor?: string } = {},
  ) {
    if (!isUuid(sessionId)) throw new NotFoundException('Sessão não encontrada');
    await this.findOne(tenantId, sessionId);
    const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
    const where = {
      conversation: { sessionId, tenantId },
    } as const;
    return this.prisma.message.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        direction: true,
        type: true,
        content: true,
        status: true,
        timestamp: true,
        conversation: {
          select: {
            id: true,
            status: true,
            contact: { select: { id: true, phone: true, name: true, avatar: true } },
          },
        },
      },
    });
  }

  async findEvents(
    tenantId: string,
    sessionId: string,
    opts: { take?: number; cursor?: string } = {},
  ) {
    if (!isUuid(sessionId)) throw new NotFoundException('Sessão não encontrada');
    await this.findOne(tenantId, sessionId);
    const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
    return this.prisma.sessionEvent.findMany({
      where: { sessionId, tenantId },
      orderBy: { createdAt: 'desc' },
      take,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        statusCode: true,
        phone: true,
        message: true,
        createdAt: true,
      },
    });
  }

  async findBySessionName(sessionName: string) {
    const session = await this.prisma.whatsappSession.findUnique({
      where: { sessionName },
      select: {
        id: true,
        tenantId: true,
        name: true,
        phone: true,
        profileName: true,
        sessionName: true,
        evolutionInstanceId: true,
        status: true,
        webhookSecretHash: true,
        lastSeen: true,
      },
    });
    return session;
  }

  // ─── QR Code ────────────────────────────────────────────────────────

  async getQrCode(tenantId: string, id: string): Promise<{
    connected: boolean;
    qrcode?: string;
    code?: string;
    pairingCode?: string;
    qrExpired?: boolean;
    qrAttempts?: number;
    qrMaxAttempts?: number;
  }> {
    const session = await this.findOne(tenantId, id);

    if (session.status === 'qr_expired') {
      return {
        connected: false,
        qrExpired: true,
        qrAttempts: session.qrAttempts ?? 0,
        qrMaxAttempts: this.qrMaxAttempts,
      };
    }

    if (session.status === 'connected') {
      await this.deleteQrCache(session.id);
      return { connected: true };
    }

    if (!session.evolutionInstanceId && session.status === 'connecting') {
      return { connected: false };
    }

    // Cache hit dentro da janela de debouncing.
    const cached = await this.getQrCache(session.id);
    const now = Date.now();
    if (cached && now - cached.generatedAt < this.qrDebounceMs) {
      return {
        connected: false,
        qrcode: cached.qrcode,
        code: cached.code,
        pairingCode: cached.pairingCode,
        qrAttempts: session.qrAttempts ?? 0,
        qrMaxAttempts: this.qrMaxAttempts,
      };
    }

    // FIX 1 — Pre-check do estado na Evolution antes de chamar /instance/connect.
    // A correção aqui é crucial: antes, qualquer falha no fetchInstance era
    // engolida pelo catch e o código seguia para evolution.connect() — que é
    // destrutivo (reinicia o Baileys). Agora:
    //  - Se fetchInstance retornar state=open → devolvemos connected=true sem chamar connect.
    //  - Se fetchInstance falhar com erro de REDE (BadGatewayException) → retornamos
    //    o cache stale ou pending, SEM chamar connect. Não derrubamos a sessão
    //    por um problema temporário de comunicação com a Evolution.
    //  - Apenas NotFoundException (instância não existe) permite seguir para connect.
    try {
      const details = await this.evolution.fetchInstance(session.sessionName);
      const evState =
        (details?.instance?.state as string | undefined) ??
        ((details?.data as Record<string, unknown> | undefined)?.state as string | undefined) ??
        ((details?.data as Record<string, unknown> | undefined)?.connection as string | undefined);
      if (evState && ['open', 'connected'].includes(evState.toLowerCase())) {
        await this.deleteQrCache(session.id);
        this.logger.log(
          `getQrCode: Evolution reporta state="${evState}" para ${session.sessionName} ` +
          `(webhook ainda não confirmou). Devolvendo connected=true sem chamar /instance/connect.`,
        );
        return { connected: true };
      }
    } catch (err) {
      if (err instanceof BadGatewayException) {
        // Erro de rede/comunicação com a Evolution — não chamamos connect().
        // Devolvemos o cache stale se existir, ou pending caso contrário.
        this.logger.warn(
          `getQrCode: fetchInstance falhou com BadGateway para ${session.sessionName}: ` +
          `${(err as Error).message} — abortando getQrCode para não derrubar sessão.`,
        );
        if (cached) {
          return {
            connected: false,
            qrcode: cached.qrcode,
            code: cached.code,
            pairingCode: cached.pairingCode,
            qrAttempts: session.qrAttempts ?? 0,
            qrMaxAttempts: this.qrMaxAttempts,
          };
        }
        return { connected: false };
      }
      // NotFoundException (instância sumiu) → deixa cair no bloco de connect abaixo.
      this.logger.debug(
        `getQrCode: fetchInstance pré-check: ${(err as Error).message} — seguindo para connect`,
      );
    }

    try {
      const qr = await this.evolution.connect(session.sessionName);

      const prevCache = await this.getQrCache(session.id);
      const prevCode = prevCache?.code;
      const isQrNovo = qr.code !== prevCode && qr.base64 !== prevCache?.qrcode;

      let newAttempts = session.qrAttempts ?? 0;
      if (isQrNovo) {
        const incrementResult = await this.prisma.whatsappSession.updateMany({
          where: {
            id: session.id,
            status: { in: ['qrcode_pending', 'connecting'] },
          },
          data: {
            qrAttempts: { increment: 1 },
            qrLastGeneratedAt: new Date(),
            status: 'qrcode_pending',
            lastSeen: new Date(),
          },
        });

        if (incrementResult.count === 0) {
          const fresh = await this.findOne(tenantId, session.id);
          this.logger.log(
            `getQrCode: race evitada — sessão ${session.id} ` +
            `mudou pra status="${fresh.status}" durante o connect. ` +
            `Devolvendo estado atual sem incrementar qrAttempts.`,
          );
          if (fresh.status === 'connected') {
            await this.deleteQrCache(session.id);
            return { connected: true };
          }
          if (fresh.status === 'qr_expired') {
            return {
              connected: false,
              qrExpired: true,
              qrAttempts: fresh.qrAttempts ?? 0,
              qrMaxAttempts: this.qrMaxAttempts,
            };
          }
          return { connected: false };
        }

        const afterIncrement = await this.prisma.whatsappSession.findUnique({
          where: { id: session.id },
          select: { qrAttempts: true },
        });
        newAttempts = afterIncrement?.qrAttempts ?? 0;

        if (newAttempts >= this.qrMaxAttempts) {
          await this.updateStatus(session.id, 'qr_expired');
          await this.deleteQrCache(session.id);
          await this.logEvent(session.id, tenantId, 'qr_expired', {
            message: `Limite de ${this.qrMaxAttempts} tentativas de QR atingido. Reconecte para gerar um novo QR.`,
            metadata: { qrAttempts: newAttempts, qrMaxAttempts: this.qrMaxAttempts },
          });
          this.logger.warn(
            `session ${session.id}: limite de QR atingido (${newAttempts}/${this.qrMaxAttempts}) — status=qr_expired`,
          );
          return {
            connected: false,
            qrExpired: true,
            qrAttempts: newAttempts,
            qrMaxAttempts: this.qrMaxAttempts,
          };
        }
      } else {
        await this.prisma.whatsappSession.updateMany({
          where: {
            id: session.id,
            status: { in: ['qrcode_pending', 'connecting'] },
          },
          data: {
            lastSeen: new Date(),
          },
        });
        this.logger.debug(
          `getQrCode: QR idêntico ao anterior para ${session.id} — ` +
          `qrAttempts preservado em ${newAttempts}.`,
        );
      }

      await this.setQrCache(session.id, {
        qrcode: qr.base64 ?? '',
        code: qr.code,
        pairingCode: qr.pairingCode,
        generatedAt: now,
      });

      return {
        connected: false,
        qrcode: qr.base64,
        code: qr.code,
        pairingCode: qr.pairingCode,
        qrAttempts: newAttempts,
        qrMaxAttempts: this.qrMaxAttempts,
      };
    } catch (err) {
      if (err instanceof NotFoundException) {
        this.logger.warn(
          `getQrCode: instância ${session.sessionName} sumiu da Evolution — recriando via job`,
        );
        await this.deleteQrCache(session.id);
        await this.updateStatus(session.id, 'connecting');
        throw new BadGatewayException(
          'A instância da Evolution não existe mais. Inicie a conexão novamente.',
        );
      }
      this.logger.warn(
        `getQrCode: Evolution connect falhou para ${session.sessionName}: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  private async resetQrAttempts(sessionId: string): Promise<void> {
    await this.deleteQrCache(sessionId);
    await this.prisma.whatsappSession.update({
      where: { id: sessionId },
      data: { qrAttempts: 0, qrLastGeneratedAt: null },
      select: { id: true },
    });
  }

  // ─── Operações de instância ────────────────────────────────────────

  async reconnect(tenantId: string, id: string): Promise<{ status: string }> {
    const session = await this.findOne(tenantId, id);

    await this.updateStatus(session.id, 'connecting');
    await this.resetQrAttempts(session.id);

    const webhook = await this.generateWebhookSecret();
    await this.prisma.whatsappSession.update({
      where: { id: session.id },
      data: { webhookSecretHash: webhook.hash },
    });
    await this.reapplyWebhook(session.sessionName, webhook.plain);

    try {
      await this.evolution.connect(session.sessionName);
      await this.updateStatus(session.id, 'qrcode_pending');
      await this.logEvent(session.id, tenantId, 'qrcode_pending', {
        message: 'QR Code regenerado (reconexão solicitada)',
      });
      return { status: 'qrcode_pending' };
    } catch (err) {
      if (err instanceof NotFoundException) {
        await this.prisma.whatsappSession.update({
          where: { id: session.id },
          data: { evolutionInstanceId: null },
        });
        this.logger.warn(
          `reconnect: instância ${session.sessionName} não existe mais — recriação necessária`,
        );
        throw new ReconnectNeedsRecreateException(webhook.plain);
      }
      throw err;
    }
  }

  private async reapplyWebhook(sessionName: string, webhookSecretPlain: string): Promise<void> {
    try {
      await this.evolution.setWebhook(sessionName, {
        url: this.evolution.buildWebhookUrl(),
        signatureHeader: { 'x-evolution-signature': webhookSecretPlain },
      });
      this.logger.log(
        `reapplyWebhook(${sessionName}): webhook reconfigurado com lista atual de eventos`,
      );
    } catch (err) {
      this.logger.warn(
        `reapplyWebhook(${sessionName}) falhou: ${(err as Error).message} — reconexão segue mesmo assim`,
      );
    }
  }

  async logout(tenantId: string, id: string): Promise<{ status: string }> {
    const session = await this.findOne(tenantId, id);

    await this.resetQrAttempts(session.id);

    try {
      await this.evolution.deleteInstance(session.sessionName);
    } catch (err) {
      if (err instanceof NotFoundException) {
        this.logger.warn(
          `logout: instância ${session.sessionName} não existe na Evolution — ` +
          `marcando pra recriar no próximo connect`,
        );
      } else {
        this.logger.warn(`logout: deleteInstance falhou: ${(err as Error).message}`);
      }
    }

    await this.prisma.whatsappSession.update({
      where: { id: session.id },
      data: {
        status: 'disconnected',
        phone: null,
        profileName: null,
        evolutionInstanceId: null,
        lastSeen: new Date(),
      },
    });

    await this.logEvent(session.id, tenantId, 'logout', {
      message: 'Desconectado pelo usuário — instância removida da Evolution',
    });

    return { status: 'disconnected' };
  }

  async rename(
    tenantId: string,
    id: string,
    newName: string,
  ): Promise<{ id: string; name: string }> {
    await this.findOne(tenantId, id);

    const trimmed = newName.trim();
    if (!trimmed) {
      throw new BadRequestException('O nome não pode ficar vazio');
    }

    const existing = await this.prisma.whatsappSession.findFirst({
      where: { tenantId, name: trimmed, NOT: { id } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'Já existe uma sessão com esse nome neste tenant',
      );
    }

    const previous = await this.prisma.whatsappSession.findUnique({
      where: { id },
      select: { name: true },
    });

    const updated = await this.prisma.whatsappSession.update({
      where: { id },
      data: { name: trimmed },
      select: { id: true, name: true },
    });

    await this.logEvent(id, tenantId, 'updated', {
      message: `Sessão renomeada: "${previous?.name ?? '?'}" → "${updated.name}"`,
    });

    return updated;
  }

  async delete(tenantId: string, id: string): Promise<{ success: true }> {
    const session = await this.findOne(tenantId, id);
    try {
      await this.evolution.deleteInstance(session.sessionName);
    } catch (err) {
      this.logger.warn(`delete: ${(err as Error).message}`);
    }
    await this.deleteQrCache(session.id);
    await this.logEvent(session.id, tenantId, 'deleted', {
      message: `Sessão "${session.name}" excluída`,
    });
    await this.prisma.whatsappSession.delete({ where: { id } });
    return { success: true };
  }

  // ─── Updates chamados pelo worker/webhook ─────────────────────────

  async updateStatus(
    sessionId: string,
    status: string,
    extra?: Record<string, unknown>,
  ) {
    return this.prisma.whatsappSession.update({
      where: { id: sessionId },
      data: { status, ...extra },
      select: { id: true, status: true, updatedAt: true },
    });
  }

  async markConnected(
    sessionId: string,
    phone?: string,
    profileName?: string | null,
  ) {
    const update = await this.prisma.whatsappSession.update({
      where: { id: sessionId },
      data: {
        status: 'connected',
        ...(phone ? { phone } : {}),
        ...(profileName ? { profileName } : {}),
        qrAttempts: 0,
        qrLastGeneratedAt: null,
        lastSeen: new Date(),
      },
      select: { id: true, status: true, phone: true, tenantId: true, name: true },
    });
    await this.deleteQrCache(sessionId);
    await this.logEvent(sessionId, update.tenantId, 'connected', {
      phone,
      message: phone
        ? `Sessão conectada com o número ${phone}${profileName ? ` (${profileName})` : ''}`
        : 'Sessão conectada',
    });

    void this.emitBotSessionCount(
      sessionId,
      update.tenantId,
    ).catch((err) =>
      this.logger.debug(
        `emitBotSessionCount (connected) falhou: ${(err as Error).message}`
      )
    );

    return update;
  }

  private async emitBotSessionCount(
    sessionId: string,
    tenantId: string,
  ): Promise<void> {
    const settings = await this.prisma.sessionSettings.findUnique({
      where: { sessionId },
      select: { activeBotId: true },
    });
    if (!settings?.activeBotId) return;

    const count = await this.prisma.whatsappSession.count({
      where: {
        tenantId,
        status: 'connected',
        settings: { activeBotId: settings.activeBotId },
      },
    });

    this.realtime.emitBotSessionCount(tenantId, {
      botId: settings.activeBotId,
      activeSessions: count,
    });
  }

  async logEvent(
    sessionId: string,
    tenantId: string,
    type: string,
    details?: {
      statusCode?: number;
      phone?: string;
      message?: string;
      metadata?: unknown;
    },
  ) {
    try {
      return await this.prisma.sessionEvent.create({
        data: {
          sessionId,
          tenantId,
          type,
          ...(details?.statusCode ? { statusCode: details.statusCode } : {}),
          ...(details?.phone ? { phone: details.phone } : {}),
          ...(details?.message ? { message: details.message } : {}),
          ...(details?.metadata !== undefined
            ? { metadata: details.metadata as object }
            : {}),
        },
        select: { id: true },
      });
    } catch (err) {
      this.logger.warn(
        `logEvent falhou (sessionId=${sessionId} type=${type}): ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ─── Validação de webhook por sessão ───────────────────────────────

  async verifyWebhookSignature(sessionName: string, providedSignature: string | undefined): Promise<boolean> {
    if (!providedSignature) return false;
    const session = await this.findBySessionName(sessionName);
    if (!session?.webhookSecretHash) return false;
    try {
      return await argon2.verify(session.webhookSecretHash, providedSignature);
    } catch {
      return false;
    }
  }

  async verifyWebhookSignatureDetailed(
    sessionName: string,
    providedSignature: string | undefined,
  ): Promise<
    | { valid: true }
    | { valid: false; reason: 'missing_signature' | 'unknown_session' | 'invalid_signature' }
  > {
    if (!providedSignature) {
      return { valid: false, reason: 'missing_signature' };
    }
    const session = await this.findBySessionName(sessionName);
    if (!session?.webhookSecretHash) {
      return { valid: false, reason: 'unknown_session' };
    }
    try {
      const ok = await argon2.verify(session.webhookSecretHash, providedSignature);
      return ok ? { valid: true } : { valid: false, reason: 'invalid_signature' };
    } catch {
      return { valid: false, reason: 'invalid_signature' };
    }
  }
}

export class ReconnectNeedsRecreateException extends Error {
  constructor(public readonly webhookSecret: string) {
    super('Instância da Evolution não existe mais — precisa recriar');
    this.name = 'ReconnectNeedsRecreateException';
  }
}
