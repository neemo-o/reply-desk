import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
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
 *   instanceName, telefone (preenchido pelo webhook quando o QR é escaneado),
 *   status, tenant_id, timestamps, metadados e o hash do secret do webhook
 *   por instância.
 *
 * 🔒 S23 — Alterações importantes nesta versão:
 *   - Criação NÃO aceita mais `phone` no DTO. O número é atribuído
 *     automaticamente pela Evolution via webhook CONNECTION_UPDATE.wid.user
 *     quando o celular escaneia o QR. O frontend não precisa (e não pode)
 *     informar o número na criação.
 *   - O limite de sessões do plano (maxSessions) agora conta o TOTAL de
 *     sessões criadas pelo tenant, não apenas as "ativas/conectadas". Assim
 *     um Basic (maxSessions=1) só pode ter 1 sessão no total, conectada ou
 *     desconectada — o usuário precisa excluir para criar outra.
 *   - O endpoint `logout` (botão "Desconectar") NÃO encerra mais a instância
 *     na Evolution — apenas faz `connect` para gerar um QR novo. A ideia é
 *     que "desconectar" vira "preciso conectar um celular diferente": o UI
 *     mostra o QR novamente. Se a instância foi removida da Evolution, criamos
 *     de volta (preservando o webhook secret).
 *   - Todos os eventos de conexão são registrados em `session_events`
 *     (método `logEvent`), substituindo o "inbox de mensagens" como log
 *     temporário. O inbox continua existindo para mensagens, mas a página de
 *     detalhes agora mostra "Logs de conexão" em seu lugar.
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

  // ─── CRUD ─────────────────────────────────────────────────────────

  /**
   * Cria a sessão no banco e enfileira a conexão (controller pega o queue).
   * Retorna o registro criado SEM QR — o QR vem do job/endpoint especial.
   *
   * 🔒 S23 — O DTO `CreateSessionDto` NÃO aceita mais `phone`: o número virá
   * automaticamente do webhook quando o celular escanear o QR.
   */
  async create(tenantId: string, dto: CreateSessionDto) {
    await this.planLimits.assertCanCreateSession(tenantId);

    // 🔒 Verifica nomes duplicados dentro do tenant (não DB-unique porque
    // o user pode recriar com o mesmo nome após deletar; sessionName é único)
    const existing = await this.prisma.whatsappSession.findFirst({
      where: { tenantId, name: dto.name },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Já existe uma sessão com esse nome neste tenant');
    }

    const sessionName = this.buildInstanceName(tenantId);
    const webhook = await this.generateWebhookSecret();

    const session = await this.prisma.whatsappSession.create({
      data: {
        tenantId,
        name: dto.name,
        // phone NÃO é mais aceito do DTO — preenchido pelo webhook ao conectar.
        phone: null,
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

    // 🪵 Log de criação
    await this.logEvent(session.id, tenantId, 'created', {
      message: `Sessão "${dto.name}" criada`,
    });

    // Devolve o secret em claro UMA única vez no retorno — o controller
    // precisa dele para configurar a Evolution (não persistente em lugar
    // nenhum além do hash no DB). O frontend não recebe isso.
    return { session, webhookSecret: webhook.plain };
  }

  /**
   * Lista sessões do tenant. Para agentes (role=agent), o controller deve
   * usar `findAllSafe` (sem dados sensíveis como sessionName/evolutionInstanceId).
   * Aqui retornamos o conjunto completo — o controller decide qual expor.
   */
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
        lastSeen: true,
        createdAt: true,
      },
    });

    // O webhook é a fonte principal do telefone/nome, mas algumas versões da
    // Evolution enviam CONNECTION_UPDATE sem o WID. Quando isto acontece a
    // sessão já aparece como conectada, porém sem número. Consultamos a
    // instância apenas nesse caso e persistimos o resultado para as próximas
    // leituras (não expõe esta consulta a agentes, que usam findAllSafe).
    return Promise.all(
      sessions.map(async (session) => {
        const needsSync =
          session.status === 'connected' && (!session.phone || !session.profileName);
        if (!needsSync) return session;
        const details = await this.syncConnectedDetails(session.id, session.sessionName);
        if (!details.phone && !details.profileName) return session;
        return { ...session, ...details };
      }),
    );
  }

  /**
   * Recupera o telefone e nome do perfil da instância já conectada como
   * fallback ao webhook. A resposta de fetchInstances varia entre builds da
   * Evolution, por isso a extração aceita os formatos usuais (ownerJid, wid,
   * number e phoneNumber; profileName/profileName do objeto externo).
   */
  private async syncConnectedDetails(
    sessionId: string,
    sessionName: string,
  ): Promise<{ phone?: string | null; profileName?: string | null }> {
    try {
      const instance = await this.evolution.fetchInstance(sessionName);
      const phone = this.extractEvolutionPhone(instance);
      const profileName = this.extractEvolutionProfileName(instance);
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
      // Não bloqueia a lista de sessões se a Evolution estiver indisponível.
      this.logger.debug(
        `session ${sessionId}: não foi possível sincronizar detalhes da Evolution: ${(err as Error).message}`,
      );
      return { phone: null, profileName: null };
    }
  }

  /**
   * Extrai o profileName da resposta de fetchInstances.
   *
   * ⚠️ Atenção: NÃO usamos `name` como chave porque a Evolution devolve o
   * `sessionName` da instância nesse campo (formato `rd-<tenant>-<rand>`).
   * Se a Evolution responder com `profileName=null` (caso comum em
   * fetchInstances), aceitar `name` faria gravar o sessionName no banco —
   * e a UI mostraria algo como "75 9 1234-5678 (rd-ebd31588-e4dde6f9ccc7)".
   * Só aceitamos `profileName` / `profile_name` (e variantes dentro do
   * objeto `profile`). Fallback para 'name' foi removido propositalmente.
   *
   * Para webhook CONNECTION_UPDATE usamos um caminho separado
   * (evolution-webhooks.service.ts) que SÓ lê do payload do evento —
   * não passa por aqui.
   */
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
      // E.164 aceita até 15 dígitos. O mínimo evita confundir IDs internos
      // curtos da instância com um telefone.
      if (digits.length >= 8 && digits.length <= 15) return digits;
    }

    for (const childKey of ['instance', 'data', 'connection', 'profile', 'wid', 'phoneNumber']) {
      const phone = this.extractEvolutionPhone(record[childKey], depth + 1);
      if (phone) return phone;
    }
    return null;
  }

  /**
   * 🔒 S23 — Lista "segura" para agentes. Retorna apenas o que um atendente
   * precisa ver: nome da sessão, status (running/not running) e último
   * visto. Sem sessionName, sem evolutionInstanceId, sem phone+detalhes.
   * O controller decide chamar este método ou `findAll` conforme a role.
   */
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
   * 🔒 S23 — Versão "segura" do findOne para agentes. Mesma lógica do
   * findAllSafe: remove dados sensíveis da Evolution.
   */
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

  /**
   * 🪵 Inbox temporário: lista as mensagens mais recentes recebidas/enviadas
   * por ESTA sessão (em qualquer conversa do tenant). Útil para o front
   * logar/visualizar o que está chegando sem precisar entrar em uma conversa
   * específica. Ordena por timestamp desc; paginação cursor.
   *
   * 🔒 S23 — Este endpoint continua existindo (pode ser usado na página de
   * conversas), mas a página de detalhes da sessão agora usa `findEvents`
   * para mostrar "Logs de conexão" em vez de mensagens.
   */
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

  /**
   * 🪵 S23 — Logs de CONEXÃO da sessão. Substitui o uso do inbox como
   * "log temporário" na página de detalhes. Retorna eventos ordenados por
   * created_at desc (mais recente primeiro) com paginação cursor simples.
   */
  async findEvents(
    tenantId: string,
    sessionId: string,
    opts: { take?: number; cursor?: string } = {},
  ) {
    if (!isUuid(sessionId)) throw new NotFoundException('Sessão não encontrada');
    // Garante que a sessão pertence ao tenant (NotFoundException se não).
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

  // ─── QR Code (sob demanda, nunca persistido) ───────────────────────

  /**
   * Busca o QR Code atual da sessão na Evolution API e devolve ao frontend.
   * O QR NÃO é armazenado no banco — é sempre buscado em tempo real.
   * Se a sessão já estiver conectada, retorna { connected: true }.
   *
   * 🔒 S23 — Antes de buscar o QR, garantimos que a instância existe na
   * Evolution: se foi removida (instance deletada lá), recriamos com o
   * mesmo webhook secret (preservando o hash). Assim "desconectar e
   * reconectar" funciona mesmo que a Evolution tenha limpo a instância.
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
      // Garante status qrcode_pending para o UI mostrar o QR
      await this.updateStatus(session.id, 'qrcode_pending');
      return {
        connected: false,
        qrcode: qr.base64,
        code: qr.code,
        pairingCode: qr.pairingCode,
      };
    } catch (err) {
      // Se a instância não existe mais na Evolution, recriamos mantendo
      // o webhook secret. O hash continua o mesmo — só precisamos do plain
      // novamente, mas não temos. Solução: geramos novo secret e atualizamos
      // o hash. Isso só acontece em edge cases (instância deletada lá).
      if (err instanceof NotFoundException) {
        this.logger.warn(
          `getQrCode: instância ${session.sessionName} sumiu da Evolution — recriando via job`,
        );
        await this.updateStatus(session.id, 'connecting');
        // Não recriamos inline — o controller reenfileira o job connect-session
        // via endpoint aparte. Aqui retornamos pending para o frontend pollar.
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

  // ─── Operações de instância ────────────────────────────────────────

  /**
   * 🔒 S23 — "Reconectar" agora é aoperação que CRIA/RECONECTA a instância
   * e volta a sessão para o estado `qrcode_pending`, exibindo o QR novamente.
   *
   * Casos:
   *  1. Instância existe na Evolution → chamamos connect, geramos novo QR.
   *  2. Instância não existe → recriamos com novo webhook secret (precisamos
   *     regerar, pois não guardamos o plain). Atualizamos o hash no banco.
   *
   * O frontend usa este endpoint para:
   *  - Botão "Conectar" (quando desconectada)
   *  - Após "Desconectar" — automaticamente o polling de QR recomeça
   */
  async reconnect(tenantId: string, id: string): Promise<{ status: string }> {
    const session = await this.findOne(tenantId, id);

    // 🔒 S23 — Se a instância ainda existe na Evolution, só precisamos
    // chamar connect. Se não existe (removida lá), precisamos recriar.
    // Para não guardar o webhook secret plain, regeramos um novo secret,
    // atualizamos o hash e reenfileiramos o job de criação (controller decide).
    await this.updateStatus(session.id, 'connecting');

    // 🔒 Gera novo webhook secret e re-aplica na Evolution para garantir
    // que o webhook configurado usa a lista ATUAL de WEBHOOK_EVENTS.
    // A Evolution mantém o webhook configurado da última vez — se trocamos
    // a lista em deploy (ex.: cortamos PRESENCE_UPDATE/CONTACTS_UPSERT),
    // instâncias antigas continuam com a lista velha. Aqui regeneramos
    // o secret, atualizamos o hash no DB e reaplicamos via setWebhook().
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
        // A instância foi deletada na Evolution. Precisamos recriar.
        // Já geramos novo webhook secret acima — usamos ele aqui também.
        await this.prisma.whatsappSession.update({
          where: { id: session.id },
          data: { evolutionInstanceId: null },
        });
        // Devolvemos um "ticket" para o controller reenfileirar o job.
        this.logger.warn(
          `reconnect: instância ${session.sessionName} não existe mais — recriação necessária`,
        );
        // Lançamos um erro específico para o controller detectar e reenfileirar.
        throw new ReconnectNeedsRecreateException(webhook.plain);
      }
      throw err;
    }
  }

  /**
   * 🔒 Re-aplica o webhook na Evolution com a lista ATUAL de WEBHOOK_EVENTS.
   * Chamado em reconexões pra garantir que instâncias existentes usem
   * a lista nova (após deploys que cortaram eventos).
   */
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
      // Falha aqui NÃO bloqueia reconexão — só logamos.
      this.logger.warn(
        `reapplyWebhook(${sessionName}) falhou: ${(err as Error).message} — reconexão segue mesmo assim`,
      );
    }
  }

  /**
   * 🔒 S23 — "Logout" muda de significado: agora é "quero trocar de celular"
   * (ou desconectar o celular atual). Em vez de encerrar a sessão na
   * Evolution (o que mantém o device emparelhado e não mostra QR novo),
   * chamamos `restart` na Evolution, que força o Baileys a regenerar o QR.
   *
   * Se o usuário realmente quer remover permanentemente, usa "Excluir".
   *
   * Comportamento:
   *  - Status vira `qrcode_pending` (mostra QR novo no UI)
   *  - phone é zerado (o próximo a escanear pode ser outro número)
   *  - Evento `logout` é logado
   *
   * Se a Evolution não tem a instância, caímos no fluxo de recriação.
   */
  async logout(tenantId: string, id: string): Promise<{ status: string }> {
    const session = await this.findOne(tenantId, id);

    // Tenta restart da instância na Evolution — isso regenera o QR sem
    // destruir credenciais existentes, permitindo reconexão com o MESMO
    // número se o usuário apenas reiniciou o celular.
    try {
      await this.evolution.restart(session.sessionName);
    } catch (err) {
      if (err instanceof NotFoundException) {
        // A instância foi removida da Evolution — vamos só marcar para reconexão.
        this.logger.warn(
          `logout: instância ${session.sessionName} não existe na Evolution — fluindo para reconexão`,
        );
      } else {
        // Outro erro — logamos mas não abortamos. O importante é o status.
        this.logger.warn(`logout: restart falhou: ${(err as Error).message}`);
      }
    }

    // Marca status como qrcode_pending e zera o phone/profileName — o próximo QR
    // pode ser escaneado por outro número, então não faz sentido manter.
    await this.prisma.whatsappSession.update({
      where: { id: session.id },
      data: {
        status: 'qrcode_pending',
        phone: null,
        profileName: null,
        lastSeen: new Date(),
      },
    });

    await this.logEvent(session.id, tenantId, 'logout', {
      message: 'Desconectado pelo usuário — QR Code regenerado',
    });

    return { status: 'qrcode_pending' };
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
      this.logger.warn(`delete: ${(err as Error).message}`);
    }
    await this.logEvent(session.id, tenantId, 'deleted', {
      message: `Sessão "${session.name}" excluída`,
    });
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
   *
   * 🔒 S23 — Garante que o `phone` esteja sincronizado com a Evolution: se
   * vier vazio do webhook, NÃO zeramos o phone existente (podemos estar
   * reprocessando um evento parcial). profileName segue a mesma regra.
   */
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
        lastSeen: new Date(),
      },
      select: { id: true, status: true, phone: true, tenantId: true, name: true },
    });
    // 🪵 Log de conexão
    await this.logEvent(sessionId, update.tenantId, 'connected', {
      phone,
      message: phone
        ? `Sessão conectada com o número ${phone}${profileName ? ` (${profileName})` : ''}`
        : 'Sessão conectada',
    });
    return update;
  }

  /**
   * 🪵 S23 — Cria um evento de log de conexão para a sessão. Substitui o
   * uso do inbox de mensagens como "log temporário" na página de detalhes.
   *
   * Tipos esperados: created | qrcode_pending | connected | disconnected
   *                  | error | logout | deleted
   */
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
      // Log de evento não deve quebrar o fluxo principal — só logamos.
      this.logger.warn(
        `logEvent falhou (sessionId=${sessionId} type=${type}): ${(err as Error).message}`,
      );
      return null;
    }
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

/**
 * 🔒 S23 — Sinal interno: o controller detecta esta exceção e reenfileira
 * o job `connect-session` com o novo webhook secret plain (que não
 * persistimos além do hash). Issso acontece quando a instância foi deletada
 * na Evolution e precisa ser recriada — edge case mas tratado.
 */
export class ReconnectNeedsRecreateException extends Error {
  constructor(public readonly webhookSecret: string) {
    super('Instância da Evolution não existe mais — precisa recriar');
    this.name = 'ReconnectNeedsRecreateException';
  }
}
