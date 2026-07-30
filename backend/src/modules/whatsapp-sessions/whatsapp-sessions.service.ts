import {
  BadGatewayException,
  BadRequestException,
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
import { ConfigService } from '@nestjs/config';
import {
  CreateSessionDto,
  normalizeContactFilterMode,
  type ContactFilterMode,
} from './dto/create-session.dto';

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

  /**
   * 🔒 S25 — Cache in-memory do último QR retornado por sessão, usado
   * para coalescer múltiplos polls do frontend (que batem a cada 2s) em
   * UMA única chamada /instance/connect. Resolve a race em que o
   * frontend pollava o QR **depois** de o usuário ter escaneado —
   * cada /instance/connect da Evolution derruba a conexão recém feita.
   *
   * Chave: sessionId do nosso banco (UUID interno), não sessionName da
   * Evolution. TTL = EVOLUTION_QR_DEBOUNCE_MS (default 20s). Map simples
   * em memória; cada entrada guarda o QR base64 + code + timestamp de
   * geração. Se o processo reiniciar, o cache some (tudo bem — o usuário
   * só vê um QR novo após 20s no pior caso).
   * 🔒 S25-c — O campo `code` também é usado pra detectar se a Evolution
   * devolveu um QR NOVO ou o mesmo (qrAttempts só conta QRs únicos).
   */
  private readonly qrCache = new Map<string, { qrcode: string; code?: string; pairingCode?: string; generatedAt: number }>();

  /**
   * 🔒 S25 — Limite de tentativas de QR antes de marcar `qr_expired`.
   * Configurável via env EVOLUTION_QR_MAX_ATTEMPTS (default 5).
   */
  private readonly qrMaxAttempts: number;

  /**
   * 🔒 S25 — Janela de debouncing entre polls (ms). Se dois polls
   * chegarem dentro dessa janela, devolvemos o QR cacheado em vez de
   * bater na Evolution de novo.
   */
  private readonly qrDebounceMs: number;

  /**
   * 🔒 Idade máxima de uma entrada do qrCache antes de ser considerada
   * órfã e removida pelo cleanup periódico. Padrão: 5 minutos (300x o
   * debounce default). Bem acima de qualquer uso legítimo.
   */
  private readonly qrCacheMaxAgeMs = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly planLimits: PlanLimitsService,
    private readonly evolution: EvolutionService,
    config: ConfigService,
  ) {
    this.qrMaxAttempts = Math.max(1, parseInt(config.get<string>('evolution.qrMaxAttempts') ?? '5', 10) || 5);
    this.qrDebounceMs = Math.max(500, parseInt(config.get<string>('evolution.qrDebounceMs') ?? '3000', 10) || 3000);

    // 🔒 Limpeza periódica do qrCache: remove entries órfãs (sessões
    // deletadas, sessões que conectaram mas não chamaram markConnected,
    // etc). .unref() impede que o timer bloqueie o shutdown do processo.
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      let removed = 0;
      for (const [key, entry] of this.qrCache.entries()) {
        if (now - entry.generatedAt > this.qrCacheMaxAgeMs) {
          this.qrCache.delete(key);
          removed += 1;
        }
      }
      if (removed > 0) {
        this.logger.debug(`qrCache: ${removed} entries órfãs removidas (total=${this.qrCache.size})`);
      }
    }, 60_000);
    cleanupInterval.unref();
  }

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
   /**
    * 🔒 S23 — O DTO `CreateSessionDto` NÃO aceita mais `phone`: o número virá
    * automaticamente do webhook quando o celular escanear o QR.
    *
    * 🔒 S24 — Validação de bot + criação de SessionSettings + gate do QR:
    *   - `activeBotId` é obrigatório (validado no DTO). Aqui checamos que
    *     o bot existe no MESMO tenant, status='published', e (se vier
    *     activeBotVersionId) que a versão pertence ao bot.
    *   - Se o bot não estiver OK → BadRequestException com mensagem clara.
    *     O frontend trata como erro de formulário e não chega a chamar
    *     o endpoint de QR.
    *   - Sessão é criada com `status='connecting'` e `SessionSettings`
    *     associado (contactFilterMode='none' por default). O job
    *     `connect-session` SÓ é enfileirado se o caller chamar o endpoint
    *     de QR depois — separamos criação de conexão (como pediu).
    */
   async create(tenantId: string, dto: CreateSessionDto) {
     await this.planLimits.assertCanCreateSession(tenantId);

     // Verifica nomes duplicados dentro do tenant
     const existing = await this.prisma.whatsappSession.findFirst({
       where: { tenantId, name: dto.name },
       select: { id: true },
     });
     if (existing) {
       throw new ConflictException('Já existe uma sessão com esse nome neste tenant');
     }

     // 🔒 S24 — Validação de bot. Tudo numa transação: se o bot for invalidado
     // entre o check e o create, abortamos.
     await this.assertBotReadyForSession(tenantId, dto.activeBotId, dto.activeBotVersionId);

     const sessionName = this.buildInstanceName(tenantId);
     const webhook = await this.generateWebhookSecret();

     const session = await this.prisma.whatsappSession.create({
       data: {
         tenantId,
         name: dto.name,
         phone: null,
         sessionName,
         // 🔒 S24 — Sessão nasce em 'connecting' mas o controller só enfileira
         // o job se o caller pedir QR — ver WhatsappSessionsController.create.
         status: 'connecting',
         webhookSecretHash: webhook.hash,
         settings: {
           create: {
             contactFilterMode: dto.contactFilterMode ?? 'none',
             activeBotId: dto.activeBotId,
             activeBotVersionId: dto.activeBotVersionId ?? null,
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
             activeBotVersionId: true,
           },
         },
       },
     });

     // Log de criação
     await this.logEvent(session.id, tenantId, 'created', {
       message: `Sessão "${dto.name}" criada` +
         (session.settings ? ` (bot=${session.settings.activeBotId ?? '-'})` : ''),
     });

     // Devolve o secret em claro UMA única vez — controller passa pro worker
     // (não persiste em lugar nenhum além do hash). Frontend não recebe.
     return { session, webhookSecret: webhook.plain };
   }

   /**
    * 🔒 S24 — Verifica que o bot referenciado pelo DTO está apto a ser
    * vinculado a uma sessão. Regras:
    *  - bot existe E pertence ao tenant
    *  - bot.status === 'published'
    *  - se activeBotVersionId vier: pertence ao bot
    *
    * Lança BadRequestException com mensagem específica (a UI usa pra
    * explicar pro usuário).
    */
   private async assertBotReadyForSession(
     tenantId: string,
     activeBotId: string,
     activeBotVersionId?: string,
   ): Promise<void> {
     const bot = await this.prisma.bot.findFirst({
       where: { id: activeBotId, tenantId },
       select: { id: true, status: true },
     });
     if (!bot) {
       throw new BadRequestException('Bot não encontrado neste tenant');
     }
     // 🔒 S24 — Os bots usam `status: 'active'` quando publicados
     // (BotsService.publish seta via tx.bot.update). draft/rascunho = 'draft'.
     if (bot.status !== 'active') {
       throw new BadRequestException(
         `Bot ainda não foi publicado (status atual: ${bot.status}). ` +
           `Publique o bot antes de criar uma sessão.`,
       );
     }
     if (activeBotVersionId) {
       const version = await this.prisma.botVersion.findFirst({
         where: { id: activeBotVersionId, botId: bot.id },
         select: { id: true },
       });
       if (!version) {
         throw new BadRequestException('A versão informada do bot não pertence ao bot selecionado');
       }
     }
   }

   /**
    * 🔒 S24 — Atualiza as configurações de uma sessão existente.
    * Usado pelo PATCH /sessions/:id/settings. NÃO reconecta nem fecha a
    * sessão — o filtro roda no próximo MESSAGES_UPSERT.
    */
   async updateSettings(
     tenantId: string,
     sessionId: string,
     dto: {
       contactFilterMode?: ContactFilterMode;
       activeBotId?: string | null;
       activeBotVersionId?: string | null;
       autoReconnect?: boolean;
       ignoreGroups?: boolean;
       readMessages?: boolean;
       typingIndicator?: boolean;
       presenceUpdate?: boolean;
       webhookUrl?: string;
     },
   ): Promise<{
     id: string;
     contactFilterMode: string;
     activeBotId: string | null;
     activeBotVersionId: string | null;
   }> {
     const session = await this.prisma.whatsappSession.findFirst({
       where: { id: sessionId, tenantId },
       select: { id: true, settings: { select: { id: true } } },
     });
     if (!session) throw new NotFoundException('Sessão não encontrada');

     // Se trocar o bot, revalida.
     let nextActiveBotId: string | null | undefined = dto.activeBotId;
     let nextActiveBotVersionId: string | null | undefined = dto.activeBotVersionId;
     if (dto.activeBotId !== undefined && dto.activeBotId !== null) {
       await this.assertBotReadyForSession(tenantId, dto.activeBotId, dto.activeBotVersionId ?? undefined);
     }
     // Se setar null explicitamente (desvincular), limpa também a versão
     if (dto.activeBotId === null) {
       nextActiveBotVersionId = null;
     }

     const updated = await this.prisma.sessionSettings.upsert({
       where: { sessionId: session.id },
       update: {
         ...(dto.contactFilterMode !== undefined ? { contactFilterMode: dto.contactFilterMode } : {}),
         ...(nextActiveBotId !== undefined ? { activeBotId: nextActiveBotId } : {}),
         ...(nextActiveBotVersionId !== undefined
           ? { activeBotVersionId: nextActiveBotVersionId }
           : {}),
         ...(dto.autoReconnect !== undefined ? { autoReconnect: dto.autoReconnect } : {}),
         ...(dto.ignoreGroups !== undefined ? { ignoreGroups: dto.ignoreGroups } : {}),
         ...(dto.readMessages !== undefined ? { readMessages: dto.readMessages } : {}),
         ...(dto.typingIndicator !== undefined ? { typingIndicator: dto.typingIndicator } : {}),
         ...(dto.presenceUpdate !== undefined ? { presenceUpdate: dto.presenceUpdate } : {}),
         ...(dto.webhookUrl !== undefined ? { webhookUrl: dto.webhookUrl } : {}),
       },
       create: {
         sessionId: session.id,
         contactFilterMode: dto.contactFilterMode ?? 'none',
         activeBotId: nextActiveBotId ?? null,
         activeBotVersionId: nextActiveBotVersionId ?? null,
       },
       select: {
         id: true,
         contactFilterMode: true,
         activeBotId: true,
         activeBotVersionId: true,
       },
       });

       // 🔒 S24-b — Normaliza modos legados ('blacklist' → 'none') na saída
       // para a UI não receber valores fora do enum atual.
       return {
       ...updated,
       contactFilterMode: normalizeContactFilterMode(updated.contactFilterMode),
       };
       }

   /**
    * 🔒 S24 — Busca os settings da sessão (helper para o controller).
    * Cria com defaults se não existir (improvável mas defensivo).
    */
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
         activeBotVersionId: true,
         autoReconnect: true,
         ignoreGroups: true,
         readMessages: true,
         typingIndicator: true,
         presenceUpdate: true,
         webhookUrl: true,
       },
     }).then((s) => ({
       ...s,
       // 🔒 S24-b — Normaliza modos legados ('blacklist' → 'none').
       contactFilterMode: normalizeContactFilterMode(s.contactFilterMode),
     }));
     }

   /**
    * 🔒 S24 — Gate de conexão (chamado pelo POST /:id/connect). Revalida
    * que o bot referenciado pelos settings ainda está publicado; se sim,
    * devolve o webhook secret plain pro worker configurar a Evolution.
    *
    * Lança BadRequestException se:
    *  - sessão sem settings.activeBotId
    *  - bot foi excluído ou despublicado entre o PATCH /settings e o connect
    *
    * Não mexe no status — quem muda status é o worker (markConnected/
    * logEvent) ou o webhook (CONNECTION_UPDATE).
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
           select: { activeBotId: true, activeBotVersionId: true },
         },
       },
     });
     if (!session) throw new NotFoundException('Sessão não encontrada');

     if (!session.settings?.activeBotId) {
       throw new BadRequestException(
         'Esta sessão não tem um bot ativo. Selecione um bot publicado nas configurações antes de gerar o QR Code.',
       );
     }

     // Revalida o bot (pode ter sido despublicado/excluído desde o PATCH)
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
     if (bot.status !== 'active') {
       throw new BadRequestException(
         `O bot vinculado a esta sessão não está mais publicado (status: ${bot.status}). ` +
           `Publique-o ou selecione outro bot antes de gerar o QR Code.`,
       );
     }

     // Versão do bot, se setada, deve existir e pertencer ao bot
     if (session.settings.activeBotVersionId) {
       const version = await this.prisma.botVersion.findFirst({
         where: {
           id: session.settings.activeBotVersionId,
           botId: bot.id,
         },
         select: { id: true },
       });
       if (!version) {
         throw new BadRequestException(
           'A versão do bot vinculada a esta sessão não existe mais. Selecione outra versão.',
         );
       }
     }

     if (!session.webhookSecretHash) {
       throw new BadRequestException('Sessão sem webhook secret configurado (estado inválido)');
     }

     // O hash no DB é argon2 do secret plain. O plain não é persistido em
     // lugar nenhum — temos que re-gerar (não dá pra recuperar). O worker
     // re-configura o webhook na Evolution com o novo secret. (S23 já
     // tinha essa regra.)
     const { plain } = await this.generateWebhookSecret();
     await this.prisma.whatsappSession.update({
       where: { id: session.id },
       data: { webhookSecretHash: await argon2.hash(plain) },
     });

     // 🔒 S25 — Limpa cache in-memory + zera qrAttempts ao iniciar uma
     // nova tentativa de conexão. Garante que /:id/connect começa do
     // zero e não carrega cache de uma tentativa anterior.
     await this.resetQrAttempts(session.id);

     return { session: { id: session.id, status: session.status }, webhookSecret: plain };
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
        // 🔒 S25 — UI pode usar pra mostrar tentativas restantes do QR.
        qrAttempts: true,
        lastSeen: true,
        createdAt: true,
        // 🔒 S24 — UI usa pra mostrar Filtro: blacklist / Bot: <nome>.
        settings: {
          select: {
            contactFilterMode: true,
            activeBotId: true,
          },
        },
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
        // 🔒 S24 — agentes veem se há filtro ativo (sem expor lista).
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
        // 🔒 S25 — Contador e timestamp do último QR. O getQrCode usa
        // qrAttempts para devolver qrExpired=true quando o limite
        // foi atingido, e qrLastGeneratedAt para diagnóstico.
        qrAttempts: true,
        qrLastGeneratedAt: true,
        lastSeen: true,
        createdAt: true,
        updatedAt: true,
        settings: {
          select: {
            webhookUrl: true,
            autoReconnect: true,
            ignoreGroups: true,
            // 🔒 S24 — dados novos que a UI consome
            contactFilterMode: true,
            activeBotId: true,
            activeBotVersionId: true,
          },
        },
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
  /**
   * 🔒 S23/S25 — Busca o QR Code atual na Evolution API e devolve ao frontend.
   *
   * Regras S25 (limite + race condition):
   *  1. **Race condition "conecta → desconecta"**: o frontend pollava a cada 2s
   *     e cada poll chamava /instance/connect na Evolution — que RECRIA a sessão
   *     Baileys. Resultado: usuário escaneava o QR, conectava, e o poll 2s
   *     depois derrubava a conexão. Agora:
   *       - Antes de chamar Evolution, verificamos se status='connected' ou
   *         se a Evolution já reporta state=open via fetchInstance (caminho
   *         rápido sem chamada destrutiva).
   *       - Cada QR gerado pelo backend é cacheado em memória por
   *         `qrDebounceMs` (default 3s). Polls dentro da janela devolvem
   *         o mesmo QR sem chamar a Evolution de novo.
   *  2. **Limite de tentativas**: contador `qrAttempts` na sessão.
   *     Cada QR novo (cache miss, ou seja, após `qrDebounceMs`) incrementa.
   *     Quando atinge `qrMaxAttempts` (default 5, env EVOLUTION_QR_MAX_ATTEMPTS),
   *     status vira 'qr_expired' e paramos de gerar QR. Frontend mostra botão
   *     "Reconectar" e o owner/admin usa POST /:id/reconnect ou /:id/connect
   *     para resetar.
   *  3. **qrLastGeneratedAt** no DB é atualizado junto com qrAttempts para
   *     diagnóstico (logs sabem quando foi o último QR gerado).
   *
   * Nunca persistimos o QR em si — ele é cache em memória + devolvido
   * em tempo real. Se o processo reiniciar, o cache some e o próximo
   * poll gera um QR novo (comportamento aceitável: o usuário só vê um
   * QR novo após o restart).
   */
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

    // 🔒 S25 — Status terminal de tentativas esgotadas: NÃO chamar
    // Evolution, devolver qrExpired=true para o frontend parar de
    // pollar e mostrar o botão "Reconectar".
    if (session.status === 'qr_expired') {
      return {
        connected: false,
        qrExpired: true,
        qrAttempts: session.qrAttempts ?? 0,
        qrMaxAttempts: this.qrMaxAttempts,
      };
    }

    if (session.status === 'connected') {
      // Limpa cache stale para essa sessão — está conectada, não tem
      // mais QR válido.
      this.qrCache.delete(session.id);
      return { connected: true };
    }

    // 🔒 Se ainda não tem evolutionInstanceId, a instância pode ainda não
    // ter sido criada (job em fila). Retornamos pending para o frontend
    // pollar novamente em 2-3s.
    if (!session.evolutionInstanceId && session.status === 'connecting') {
      return { connected: false };
    }

    // 🔒 S25 — Cache hit dentro da janela de debouncing: devolve o QR
    // anterior sem chamar a Evolution. ESSENCIAL — sem isso, cada poll
    // do frontend (a cada 2s) batia na Evolution e invalidava o QR
    // recém-escaneado.
    const cached = this.qrCache.get(session.id);
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

    // 🔒 S25-b — Pré-check do estado real na Evolution ANTES de chamar
    // /instance/connect. Cobre a race condition em que o usuário escaneou
    // o QR, a Evolution já marcou state=open, MAS o webhook
    // CONNECTION_UPDATE ainda não chegou no backend (lag de rede).
    //
    // Se chamar /instance/connect nesse momento, a Evolution Reinicia o
    // Baileys e derruba exatamente a conexão que acabou de estabelecer —
    // voltando pra "connecting" e invalidando o QR escaneado.
    //
    // fetchInstance é read-only (GET /instance/fetchInstances) e devolve
    // o estado atual. Se vier state=open/connected, consideramos a
    // sessão conectada já; deixamos o webhook chegar naturalmente pra
    // markConnected() e não chamamos connect. (Silenciosamente: se
    // fetchInstance falhar, seguimos pelo caminho antigo.)
    try {
      const details = await this.evolution.fetchInstance(session.sessionName);
      const evState =
        (details?.instance?.state as string | undefined) ??
        ((details?.data as Record<string, unknown> | undefined)?.state as string | undefined) ??
        ((details?.data as Record<string, unknown> | undefined)?.connection as string | undefined);
      if (evState && ['open', 'connected'].includes(evState.toLowerCase())) {
        this.qrCache.delete(session.id);
        this.logger.log(
          `getQrCode: Evolution reporta state="${evState}" para ${session.sessionName} ` +
          `(webhook ainda não confirmou). Devolvendo connected=true sem chamar /instance/connect.`,
        );
        return { connected: true };
      }
    } catch (err) {
      // Não bloqueia — pode ser que a instância ainda não exista (job em
      // fila). Prossegue para o caminho original (evolution.connect).
      this.logger.debug(
        `getQrCode: fetchInstance pré-check falhou para ${session.sessionName}: ${(err as Error).message}`,
      );
    }

    try {
      const qr = await this.evolution.connect(session.sessionName);

      // 🔒 S25-c — Conta QRs ÚNICOS, não cache misses.
      //
      // ANTES: cada cache miss incrementava qrAttempts. Com polls a cada
      // 2s e cache de 3s, em ~15s o frontend fazia 8 polls, ~5 cache misses
      // -> 5 incrementos -> qr_expired. Era o bug observado: a sessão
      // caía em qr_expired SEM o usuário ter chegado a escanear o QR.
      //
      // AGORA: só incrementamos qrAttempts quando a Evolution devolve um
      // QR com `code` DIFERENTE do último QR já devolvido pra essa sessão.
      // Assim:
      //  - polls repetidos no mesmo QR (cache expira, mas a Evolution
      //    devolve o mesmo code) NÃO incrementam.
      //  - cada QR NOVO que a Evolution gera (regeneração automática a
      //    cada ~30s, ou após logout/reconnect) conta como 1 tentativa.
      //  - o `qrCache` ainda protege contra spam de /instance/connect
      //    dentro do debounce; o branch abaixo é o caminho cold.
      const prevCache = this.qrCache.get(session.id);
      const prevCode = prevCache?.code;
      const isQrNovo = qr.code !== prevCode && qr.base64 !== prevCache?.qrcode;

      // 🔒 S25-b — Race condition "escaneou mas poll ainda incrementa QR":
      // só incrementa qrAttempts + seta status=qrcode_pending SE o status
      // atual ainda for um dos "aguardando QR" (qrcode_pending/connecting)
      // E SE o QR for efetivamente novo. updateMany atômico garante que
      // não sobrescrevemos `connected` se o webhook chegou entre o findOne
      // e este update. Se o webhook já mudou pra connected/disconnected/
      // qr_expired, o updateMany afeta 0 linhas e devolvemos o estado
      // real mais recente sem incrementar.
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

        // 🔒 S25-b — 0 linhas afetadas = outra transição ganhou a corrida
        // (webhook connected, disconnected, ou qr_expired de outra thread).
        // NÃO incrementamos qrAttempts nem sobrescrevemos status. Devolvemos
        // o estado atual real: conectado (saída limpa) ou qr_expired (UI
        // mostra botão Reconectar).
        if (incrementResult.count === 0) {
          const fresh = await this.findOne(tenantId, session.id);
          this.logger.log(
            `getQrCode: race evitada — sessão ${session.id} ` +
            `mudou pra status="${fresh.status}" durante o connect. ` +
            `Devolvendo estado atual sem incrementar qrAttempts.`,
          );
          if (fresh.status === 'connected') {
            this.qrCache.delete(session.id);
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
          // Status virou disconnected/etc — não há QR a devolver.
          return { connected: false };
        }

        // Incrementamos uma linha — relê qrAttempts atual para checar limite.
        const afterIncrement = await this.prisma.whatsappSession.findUnique({
          where: { id: session.id },
          select: { qrAttempts: true },
        });
        newAttempts = afterIncrement?.qrAttempts ?? 0;

        if (newAttempts >= this.qrMaxAttempts) {
          // Esgotou tentativas: marca terminal e loga.
          await this.updateStatus(session.id, 'qr_expired');
          this.qrCache.delete(session.id);
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
        // QR igual ao anterior: não é "tentativa nova", só reforça status
        // qrcode_pending (sem incrementar) e lastSeen. Mesma guarda atômica
        // pra não sobrescrever connected se o webhook já chegou.
        await this.prisma.whatsappSession.updateMany({
          where: {
            id: session.id,
            status: { in: ['qrcode_pending', 'connecting'] },
          },
          data: {
            lastSeen: new Date(),
            // Não toca em qrAttempts nem qrLastGeneratedAt.
          },
        });
        this.logger.debug(
          `getQrCode: QR idêntico ao anterior para ${session.id} — ` +
          `qrAttempts preservado em ${newAttempts}.`,
        );
      }

      // Cacheia o QR recém-gerado para coalescer os próximos polls.
      this.qrCache.set(session.id, {
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
      // Se a instância não existe mais na Evolution, recriamos mantendo
      // o webhook secret. O hash continua o mesmo — só precisamos do plain
      // novamente, mas não temos. Solução: geramos novo secret e atualizamos
      // o hash. Isso só acontece em edge cases (instância deletada lá).
      if (err instanceof NotFoundException) {
        this.logger.warn(
          `getQrCode: instância ${session.sessionName} sumiu da Evolution — recriando via job`,
        );
        // 🔒 S25 — Limpa cache ao recriar (status novo, QR novo vai
        // chegar diferente).
        this.qrCache.delete(session.id);
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

  /**
   * 🔒 S25 — Reseta o contador de tentativas de QR. Chamado por:
   *   - create()  (nova sessão sempre começa em 0)
   *   - startConnect()  (POST /:id/connect)
   *   - reconnect()  (POST /:id/reconnect)
   *   - markConnected()  (webhook CONNECTION_UPDATE state=open)
   * Também limpa o cache in-memory do QR.
   */
  private async resetQrAttempts(sessionId: string): Promise<void> {
    this.qrCache.delete(sessionId);
    await this.prisma.whatsappSession.update({
      where: { id: sessionId },
      data: { qrAttempts: 0, qrLastGeneratedAt: null },
      select: { id: true },
    });
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

    // 🔒 S25 — Limpa cache e zera qrAttempts ANTES da chamada à Evolution.
    // Sem isso, a sessão poderia estar em qr_expired e o cache devolveria
    // QR stale (ou ficaria órfão em memória). Reset aqui é o caminho canônico
    // de "começar do zero" — equivalente a um POST /:id/connect novo.
    await this.resetQrAttempts(session.id);

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
   * 🔒 S23 — "Logout" significa "quero desconectar / trocar de celular". Para
   * trocar de número de fato é preciso remover as credenciais persistidas em
   * /evolution_data — caso contrário o Baileys reconecta automaticamente
   * usando essas credenciais. Por isso usamos `deleteInstance` da Evolution
   * (DELETE /instance/delete/{name}), que remove a instância AND os arquivos
   * auth do Baileys, impossibilitando reconexão pelo mesmo número.
   *
   * Diferente de `delete()` (que apaga a sessão ReplyDesk do banco), o
   * `logout` preserva a sessão no DB e só zera `evolutionInstanceId` — o
   * histórico de conversas, settings e o nome da sessão permanecem. O
   * usuário pode então clicar em "Reconectar" pra gerar um QR novo.
   *
   * 🔒 S25-d — Status final: `disconnected` (NÃO `qrcode_pending`).
   * Antes eu setava `qrcode_pending` achando que QR novo viria sozinho,
   * mas como removemos a instância via `deleteInstance`, NENHUM QR é
   * gerado automaticamente — não há instância pra gerar. Setar
   * `qrcode_pending` era uma mentira pro usuário (UI mostrava spinner
   * de QR infinito). Com `disconnected` a UI mostra estado "desconectado"
   * e o botão "Reconectar" ativa — só ao clicar o usuário tem QR novo.
   *
   * BUG PREVENTIDO: ANTES usávamos `evolution.logout()` (DELETE
   * /instance/logout/{name}). Esse só avisa o Baileys pra fechar a conexão
   * WebSocket momentaneamente, mas as credenciais em /evolution_data
   * continuavam válidas. Resultado: o celular continuava "conectado" no
   * WhatsApp mesmo depois do usuário clicar em Desconectar, e a Evolution
   * voltava a mandar CONNECTION_UPDATE state=connecting sozinha tentando
   * reconectar no mesmo número.
   *
   * RACE: o webhook `CONNECTION_UPDATE state=close` chega logo após o
   * `deleteInstance` (devido ao fechamento da conexão pelo Baileys).
   * Antes, esse webhook sobrescrevia `qrcode_pending` → `disconnected`,
   * mas como agora o `logout` também seta `disconnected`, não há
   * conflito — o status final é consistentemente `disconnected`.
   *
   * Comportamento:
   *  - Instância removida da Evolution (inclui /evolution_data)
   *  - `evolutionInstanceId` no DB setado pra null (próximo connect recria)
   *  - Status `disconnected` (UI mostra "Desconectado", botão Reconnect ativa)
   *  - 🔒 S25 — Zera qrAttempts + limpa qrCache
   *  - phone é zerado (não há conexão ativa com nenhum número)
   *  - Evento `logout` é logado
   */
  async logout(tenantId: string, id: string): Promise<{ status: string }> {
    const session = await this.findOne(tenantId, id);

    // 🔒 S25-b — Zera contador de tentativas e cache antes de chamar a
    // Evolution. Sem isso, a polling do frontend que já estava rodando
    // (em estado connecting/qrcode_pending legado) continuaria chamando
    // getQrCode e incrementando qrAttempts enquanto o logout ainda
    // processava, levando direto a qr_expired logo após desconectar.
    await this.resetQrAttempts(session.id);

    // Delete da instância na Evolution encerra a sessão do WhatsApp E
    // remove os arquivos de credenciais em /evolution_data. Usa DELETE
    // /instance/delete/{name} (não /instance/logout). Importante: isso
    // APAGA a instância da Evolution, mas preserva nossa sessão no DB.
    // O próximo /:id/connect (ou /:id/reconnect) recria a instância —
    // porque marcamos evolutionInstanceId=null abaixo (caminho de recriação
    // do serviço).
    try {
      await this.evolution.deleteInstance(session.sessionName);
    } catch (err) {
      if (err instanceof NotFoundException) {
        // A instância foi removida da Evolution — tudo bem, é o estado
        // que queríamos alcançar de qualquer forma.
        this.logger.warn(
          `logout: instância ${session.sessionName} não existe na Evolution — ` +
          `marcando pra recriar no próximo connect`,
        );
      } else {
        // Outro erro — logamos mas não abortamos. O importante é o status.
        this.logger.warn(`logout: deleteInstance falhou: ${(err as Error).message}`);
      }
    }

    // 🔒 S25-d — Marca status como `disconnected` (não qrcode_pending):
    // acabamos de remover a instância da Evolution, então NENHUM QR está
    // disponível. O usuário tem que clicar em "Reconectar" pra recriar a
    // instância e gerar QR novo. Em `disconnected` a UI mostra estado
    // "Desconectado" e o botão Reconnect é habilitado (perfazente do
    // meu comentário S25-d acima).
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

  /**
   * 🔒 S24-b — Renomeia o nome de exibição da sessão (apenas o `name`,
   * que aparece na UI/tabela). NÃO altera `sessionName` (identificador
   * interno único usado pela Evolution) nem `phone`. Não reconecta a
   * sessão — é só um update de metadata.
   *
   * Lança ConflictException se já existir outra sessão do tenant com o
   * mesmo nome (validação de unicidade dentro do tenant).
   */
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
    // 🔒 Limpa qrCache ao deletar (evita memory leak de entries órfãs).
    this.qrCache.delete(session.id);
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
        // 🔒 S25 — Quando conecta, zera qrAttempts e limpa cache. Garante
        // que a próxima vez que essa sessão precisar de QR (desconectou
        // e reconectou), o contador começa do zero de novo.
        qrAttempts: 0,
        qrLastGeneratedAt: null,
        lastSeen: new Date(),
      },
      select: { id: true, status: true, phone: true, tenantId: true, name: true },
    });
    // 🔒 S25 — Limpa cache in-memory também (qrAttempts reset no DB já
    // cobre o caso, mas o cache guardava o QR até qrDebounceMs atrás —
    // se o usuário escaneia e volta a pedir o QR antes disso, o cache
    // ainda serviria um QR velho da Evolution).
    this.qrCache.delete(sessionId);
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

  /**
   * 🔒 Versão detalhada de `verifyWebhookSignature` que devolve o motivo
   * da rejeição — usado pelo `EvolutionWebhookController` para emitir
   * métricas granulares via `WebhookMetricsService`.
   *
   * Retornos:
   *  - { valid: true }                                     ✓ aceito
   *  - { valid: false, reason: 'missing_signature' }       sem header
   *  - { valid: false, reason: 'unknown_session' }        sessão não existe
   *  - { valid: false, reason: 'invalid_signature' }     argon2 mismatch
   */
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
