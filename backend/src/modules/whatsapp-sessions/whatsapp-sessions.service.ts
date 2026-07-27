import {
  BadGatewayException,
  ConflictException,
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
import { CreateSessionDto } from './dto/create-session.dto';

/**
 * 🔒 WhatsappSessionsService — orquestra sessões de WhatsApp no banco.
 *
 * A Evolution API cuida da CONEXÃO e PERSISTÊNCIA das sessões (credenciais,
 * estado da sessão em /evolution_data). O banco guarda SOMENTE:
 *   instanceName, telefone (se conectado), status, tenant_id, timestamps,
 *   metadados e o hash do secret do webhook por instância.
 *
 * Fluxo de criação (POST /whatsapp/sessions):
 *   1. Verifica limite de sessões do plano (PlanLimitsService)
 *   2. Gera instanceName único (`rd-<tenantShort>-<rand>`)
 *   3. Gera secret de validação por sessão (32 bytes hex)
 *   4. Cria registro no DB com status `connecting` (sem QR)
 *   5. Enfileira job BullMQ `connect-session` no controller — o worker
 *      chama EvolutionService.createInstance + connect e atualiza status
 *
 * O QR Code é buscado sob demanda no endpoint GET /sessions/:id/qr,
 * que chama EvolutionService.connect(instanceName) e devolve ao frontend
 * sem jamais tocar o banco.
 */
@Injectable()
export class WhatsappSessionsService {
  private readonly logger = new Logger(WhatsappSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitsService,
    private readonly evolution: EvolutionService,
  ) {}

  /**
   * Gera um instanceName único para a Evolution API.
   * Formo: `rd-<tenantShort>-<rand>` — prefixo `rd-` evita colisão com
   * instâncias de outros sistemas compartilhando a mesma Evolution API.
   * tenantShort = primeiros 8 chars do tenantId (uuid).
   */
  private buildInstanceName(tenantId: string): string {
    const tenantShort = tenantId.replace(/-/g, '').slice(0, 8).toLowerCase();
    const rand = randomBytes(6).toString('hex');
    return `rd-${tenantShort}-${rand}`;
  }

  /**
   * Gera o secret de validação de webhook por sessão.
   * Esse secret é enviado à Evolution como header customizado
   * (`x-evolution-signature`) e validado no controller /webhooks/evolution.
   * Guardamos só o hash (argon2) no banco.
   */
  private async generateWebhookSecret(): Promise<{ plain: string; hash: string }> {
    const plain = randomBytes(32).toString('hex');
    const hash = await argon2.hash(plain);
    return { plain, hash };
  }

  /**
   * Header que enviamos à Evolution para ela repassar em cada callback.
   * Esse header é o que o controller valida (comparando argon2.verify).
   */
  private buildSignatureHeader(plainSecret: string): Record<string, string> {
    return { 'x-evolution-signature': plainSecret };
  }

  // ─── CRUD ─────────────────────────────────────────────────────────

  /**
   * Cria a sessão no banco e enfileira a conexão (controller pega o queue).
   * Retorna o registro criado SEM QR — o QR vem do job/endpoint especial.
   */
  async create(tenantId: string, dto: CreateSessionDto) {
    await this.planLimits.assertCanCreateSession(tenantId);

    // 🔒 Verifica nomes duplicados dentro do tenant (não DB-unique porque
    // o user pode recriar com o mesmo nome após deletar; sessionName é único)
    const existing = await this.prisma.whatsappSession.findFirst({
      where: { tenantId, name: dto.name, status: { notIn: ['disconnected', 'deleting'] } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Já existe uma sessão ativa com esse nome neste tenant');
    }

    const sessionName = this.buildInstanceName(tenantId);
    const webhook = await this.generateWebhookSecret();

    const session = await this.prisma.whatsappSession.create({
      data: {
        tenantId,
        name: dto.name,
        phone: dto.phone ?? null,
        sessionName,
        status: 'connecting',
        webhookSecretHash: webhook.hash,
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
      },
    });

    // Devolve o secret em claro UMA única vez no retorno — o controller
    // precisa dele para configurar a Evolution (não persistente em lugar
    // nenhum além do hash no DB). O frontend não recebe isso.
    return { session, webhookSecret: webhook.plain };
  }

  findAll(tenantId: string, opts: { take?: number; cursor?: string } = {}) {
    const take = Math.min(Math.max(opts.take ?? 50, 1), 100);
    return this.prisma.whatsappSession.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        name: true,
        phone: true,
        sessionName: true,
        evolutionInstanceId: true,
        status: true,
        lastSeen: true,
        createdAt: true,
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
        sessionName: true,
        evolutionInstanceId: true,
        status: true,
        lastSeen: true,
        createdAt: true,
        updatedAt: true,
        settings: { select: { webhookUrl: true, autoReconnect: true, ignoreGroups: true } },
      },
    });
    if (!session) throw new NotFoundException('Sessão não encontrada');
    return session;
  }

  /**
   * Lookup por sessionName — usado pelo webhook controller para identificar
   * a sessão a partir do payload da Evolution (`instance` field).
   * Não valida tenantId — é chamado pelo webhook público.
   */
  async findBySessionName(sessionName: string) {
    const session = await this.prisma.whatsappSession.findUnique({
      where: { sessionName },
      select: {
        id: true,
        tenantId: true,
        name: true,
        phone: true,
        sessionName: true,
        evolutionInstanceId: true,
        status: true,
        webhookSecretHash: true,
        lastSeen: true,
      },
    });
    return session;
  }

  // ─── QR Code (sob demanda, nunca persistido) ───────────────────────

  /**
   * Busca o QR Code atual da sessão na Evolution API e devolve ao frontend.
   * O QR NÃO é armazenado no banco — é sempre buscado em tempo real.
   * Se a sessão já estiver conectada, retorna { connected: true }.
   */
  async getQrCode(tenantId: string, id: string): Promise<{
    connected: boolean;
    qrcode?: string;
    code?: string;
    pairingCode?: string;
  }> {
    const session = await this.findOne(tenantId, id);
    if (session.status === 'connected') {
      return { connected: true };
    }
    // 🔒 Se ainda não tem evolutionInstanceId, a instância pode ainda não
    // ter sido criada (job em fila). Retornamos pending para o frontend
    // pollar novamente em 2-3s.
    if (!session.evolutionInstanceId && session.status === 'connecting') {
      return { connected: false };
    }
    try {
      const qr = await this.evolution.connect(session.sessionName);
      // Evolution connect retorna base64 do QR (com prefixo data:image sometimes)
      return {
        connected: false,
        qrcode: qr.base64,
        code: qr.code,
        pairingCode: qr.pairingCode,
      };
    } catch (err) {
      this.logger.warn(
        `getQrCode: Evolution connect falhou para ${session.sessionName}: ${(err as Error).message}`,
      );
      // Se a Evolution não tem a instância (instância deletada lá), marca
      // a sessão como desconectada para o usuário recriar.
      if (err instanceof NotFoundException) {
        await this.updateStatus(session.id, 'disconnected');
      }
      throw err;
    }
  }

  // ─── Operações de instância ────────────────────────────────────────

  /**
   * Reconnect: força a Evolution a reconectar a sessão (mantém instância).
   * Útil quando a sessão caiu (status disconnected na Evolution) mas a
   * instância ainda existe.
   */
  async reconnect(tenantId: string, id: string): Promise<{ status: string }> {
    const session = await this.findOne(tenantId, id);
    await this.updateStatus(session.id, 'connecting');
    try {
      // tentamos connect primeiro; se a instância sumiu, criamos de novo
      await this.evolution.connect(session.sessionName);
      return { status: 'connecting' };
    } catch (err) {
      if (err instanceof NotFoundException) {
        // instância foi deletada — precisaria recriar; por enquanto marca erro
        this.logger.warn(`reconnect: instância ${session.sessionName} não existe mais na Evolution`);
        await this.updateStatus(session.id, 'disconnected');
        throw new BadGatewayException(
          'A instância da Evolution não existe mais. Crie uma nova sessão.',
        );
      }
      throw err;
    }
  }

  /**
   * Logout: encerra a sessão na Evolution mantendo a instância.
   * O usuário pode reconectar depois sem reescanear QR.
   */
  async logout(tenantId: string, id: string): Promise<{ status: string }> {
    const session = await this.findOne(tenantId, id);
    try {
      await this.evolution.logout(session.sessionName);
    } catch (err) {
      // Se a instância não existe mais, ignoramos — só atualizamos status
      this.logger.warn(`logout: ${(err as Error).message}`);
    }
    await this.updateStatus(session.id, 'disconnected');
    return { status: 'disconnected' };
  }

  /**
   * Delete: remove permanentemente a instância da Evolution AND do banco.
   * As credenciais em /evolution_data são destruídas.
   */
  async delete(tenantId: string, id: string): Promise<{ success: true }> {
    const session = await this.findOne(tenantId, id);
    try {
      await this.evolution.deleteInstance(session.sessionName);
    } catch (err) {
      // Se a instância já foi removida, continuamos e apagamos do DB
      this.logger.warn(`delete: ${(err as Error).message}`);
    }
    // CascadeType: sessions → conversations cascade; OK apagar
    await this.prisma.whatsappSession.delete({ where: { id } });
    return { success: true };
  }

  // ─── Updates chamados pelo worker/webhook ─────────────────────────

  /**
   * Atualiza status e metadados da sessão. Chamado pelo processor depois
   * que a instância foi criada com sucesso (preenche evolutionInstanceId)
   * e pelo webhook controller quando CONNECTION_UPDATE chega.
   */
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

  /**
   * Marca a sessão como conectada com o número retornado pela Evolution.
   * Chamado pelo webhook handler quando CONNECTION_UPDATE → open.
   */
  async markConnected(sessionId: string, phone?: string) {
    return this.prisma.whatsappSession.update({
      where: { id: sessionId },
      data: {
        status: 'connected',
        ...(phone ? { phone } : {}),
        lastSeen: new Date(),
      },
      select: { id: true, status: true, phone: true },
    });
  }

  // ─── Validação de webhook por sessão ───────────────────────────────

  /**
   * Verifica que o header `x-evolution-signature` recebido numa chamada
   * de webhook da Evolution corresponde ao secret armazenado (hash) para
   * a sessão com `sessionName`. Essa é a "assinatura por instância":
   * um secret único por sessão, definido no webhook.set(headers) da
   * Evolution, e validado aqui com argon2.verify.
   */
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
}
