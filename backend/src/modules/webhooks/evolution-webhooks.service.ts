import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EvolutionService } from '../../common/evolution/evolution.service';
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
 *  - MESSAGES_UPSERT   → 🤖 persistir mensagem recebida + logar + enviar
 *                         resposta placeholder (ver EVO_PLACEHOLDER_OWNER_PHONE)
 *  - SEND_MESSAGE       → marca mensagens enviadas como ACK no banco (TODO)
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
    private readonly evolution: EvolutionService,
    private readonly config: ConfigService,
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

    // 🔒 M20 — A Evolution API v2 (builds recentes) envia o nome do evento em
    // diferentes formatos dependendo da versão e do integration: `MESSAGES_UPSERT`,
    // `messages.upsert`, `messages-upsert`, `messages_upsert` etc. Aqui
    // normalizamos para SCREAMING_SNAKE_CASE para casar com o switch abaixo.
    // Tabela de equivalências:
    //   messages.upsert  → MESSAGES_UPSERT
    //   connection.update → CONNECTION_UPDATE
    //   qrcode.updated   → QRCODE_UPDATED
    //   application.startup → APPLICATION_STARTUP
    //   messages.update  → MESSAGES_UPDATE
    //   messages.delete  → MESSAGES_DELETE
    //   send.message     → SEND_MESSAGE
    //   contacts.upsert  → CONTACTS_UPSERT
    //   presence.update  → PRESENCE_UPDATE
    const normalizedEvent = event
      .toUpperCase()
      .replace(/[.\s-]+/g, '_');

    const session = await this.sessionsService.findBySessionName(instanceName);
    if (!session) {
      // Log nível info (não warn): durante setup é comum receber webhook
      // de instância criada em outro ambiente (evolution compartilhada).
      this.logger.log(`Webhook Evolution: instância "${instanceName}" não cadastrada no DB — ignorando`);
      return { ok: true };
    }

    // 🪵 Log do evento para diagnóstico de formato. CONNECTION_UPDATE é o
    // mais importante: é onde o phone precisa chegar. Se o número não
    // aparecer na tabela, esse log mostra exatamente que campo a Evolution
    // preencheu. Outros eventos (MESSAGES_UPSERT) ficam em debug para não
    // inundar stdout; CONNECTION_UPDATE fica em WARN/INFO porque é raro.
    const isConnectionEvent =
      normalizedEvent === 'CONNECTION_UPDATE' || normalizedEvent === 'APPLICATION_STARTUP';
    (isConnectionEvent ? this.logger.warn : this.logger.debug).call(
      this.logger,
      `[${normalizedEvent}] session=${session.id} tenant=${session.tenantId} ` +
        `state=${session.status} data=${JSON.stringify(raw.data ?? null).slice(0, 600)}`,
    );

    switch (normalizedEvent) {
      case 'CONNECTION_UPDATE':
        await this.onConnectionUpdate(session, raw.data);
        break;
      case 'QRCODE_UPDATED':
        // Não persistimos QR no banco — frontend busca sob demanda.
        // 🔒 S23 — Loga o evento (QR foi gerado/atualizado pela Evolution).
        await this.sessionsService.updateStatus(session.id, session.status, {
          lastSeen: new Date(),
        });
        await this.sessionsService.logEvent(session.id, session.tenantId, 'qrcode_pending', {
          message: 'QR Code gerado pela Evolution',
          metadata: raw.data as object,
        });
        break;
      case 'APPLICATION_STARTUP':
        // A Evolution reiniciou e a instância subiu — basta atualizar
        // lastSeen. Status de conexão virá em CONNECTION_UPDATE separado.
        await this.sessionsService.updateStatus(session.id, session.status, {
          lastSeen: new Date(),
        });
        await this.sessionsService.logEvent(session.id, session.tenantId, 'qrcode_pending', {
          message: 'Instância reiniciada na Evolution (APPLICATION_STARTUP)',
        });
        break;
      case 'MESSAGES_UPSERT':
        await this.onMessagesUpsert(session, raw.data);
        break;
      default:
        // 🔒 M20 — Loga em `warn` (não `debug`) para facilitar diagnóstico
        // quando a Evolution enviar um evento novo que ainda não mapeamos.
        // OBS: A lista de eventos esperada vem de EvolutionService.WEBHOOK_EVENTS
        // (atualmente: APPLICATION_STARTUP, QRCODE_UPDATED, CONNECTION_UPDATE,
        // MESSAGES_UPSERT). Qualquer outro aqui significa (a) Evolution
        // adicionou um evento novo, ou (b) assinatura divergente.
        this.logger.warn(`[${normalizedEvent}] evento não mapeado (original="${event}") — ignorado`);
    }

    return { ok: true };
  }

  /**
   * CONNECTION_UPDATE — atualiza status da sessão refletindo a conexão
   * real do WhatsApp na Evolution. Também registra um SessionEvent para
   * cada transição (qrcode_pending, connected, disconnected) — esse é o
   * "log de conexão" que aparece na página de detalhes da sessão.
   *
   * data pode conter:
   *   {
   *     state: 'open' | 'close' | 'connecting' | ...,
   *     statusCode?: 401 | 440 | 408 | ...,
   *     disconnectionReasonCode?: 401,
   *     disconnectionObject?: { ... },
   *     wid?: { user: '5511999999999', server: 's.whatsapp.net' },
   *     // alguns fluxos trazem:
   *     number?: '5511999999999',
   *     user?: '5511999999999',
   *     phoneNumber?: { id: '5511999999999', ... },
   *   }
   * Em alguns fluxos o estado é `status` em vez de `state` — aceitamos ambos.
   */
  private async onConnectionUpdate(
    session: { id: string; tenantId: string; sessionName: string; status: string },
    data: unknown,
  ) {
    if (typeof data !== 'object' || data === null) return;
    const d = data as Record<string, unknown>;
    const state = (d.state ?? d.status) as string | undefined;
    if (!state) return;

    // 🔒 S23 — Captura robusta do phone: a Evolution pode enviá-lo em vários
    // formatos dependendo do build e do integration (Baileys, etc.):
    //   - data.wid.user              (formato Baileys clássico, objeto)
    //   - data.wid                   (string "5511999999999@s.whatsapp.net")
    //   - data.user                  (alguns builds)
    //   - data.number                 (Evolution API v2 normalizado)
    //   - data.phoneNumber.id        (formato alternativo)
    //   - data.instance.phone        (formato fetchInstances)
    //   - data.wuid                   (Evolution API v2 + Baileys atual — formato
    //                                  "557591722837@s.whatsapp.net"; observado
    //                                  em produção quando wid vem vazio)
    //   - data.ownerJid               (alguns builds; mesmo formato do wuid)
    // Não usamos data.id (esse é o event id, não o número).
    const wid = d.wid as Record<string, unknown> | string | undefined;
    const phoneNumber = d.phoneNumber as Record<string, unknown> | undefined;
    const instance = d.instance as Record<string, unknown> | undefined;
    const widUser = typeof wid === 'object' ? (wid?.user as string | undefined) : undefined;
    // wid como string? extrai a parte antes do @s.whatsapp.net
    const widString = typeof wid === 'string' ? wid.split('@')[0].replace(/\D/g, '') : undefined;
    // wuid / ownerJid são strings no formato "<phone>@s.whatsapp.net" — extrai só dígitos.
    const wuidString =
      typeof d.wuid === 'string'
        ? (d.wuid as string).split('@')[0].replace(/\D/g, '')
        : undefined;
    const ownerJidString =
      typeof d.ownerJid === 'string'
        ? (d.ownerJid as string).split('@')[0].replace(/\D/g, '')
        : undefined;
    const phone =
      widUser ??
      widString ??
      wuidString ??
      ownerJidString ??
      (d.user as string | undefined) ??
      (d.number as string | undefined) ??
      (phoneNumber?.id as string | undefined) ??
      (phoneNumber?.user as string | undefined) ??
      (instance?.phone as string | undefined);

    // 🔒 Profile name — vem em data.profileName quando a Evolution envia
    // junto com state=open (ex.: "Empresa XY"). Limpa whitespace e descarta
    // strings vazias para não gravar " " no banco.
    const rawProfileName =
      (d.profileName as string | undefined) ??
      (d.profile_name as string | undefined) ??
      ((d.profile as Record<string, unknown> | undefined)?.name as string | undefined);
    const profileName =
      typeof rawProfileName === 'string' && rawProfileName.trim().length > 0
        ? rawProfileName.trim()
        : null;

    // 🪵 Diagnóstico: quando a Evolution diz state=open mas o phone não veio
    // em nenhum dos formatos mapeados, logamos o payload cru `data` em `warn`.
    // Sem isso não dá pra saber que campo novo a API usou — e o usuário pega
    // só "— sem número" na tabela sem entender o motivo.
    const stateLower = state.toLowerCase();
    if ((stateLower === 'open' || stateLower === 'connected') && !phone) {
      this.logger.warn(
        `session ${session.id}: CONNECTION_UPDATE state="${state}" sem phone detectável! ` +
        `Payload cru data=${JSON.stringify(data).slice(0, 800)}`,
      );
    }

    // 🔒 M20 — A Evolution expõe o motivo do disconnect em campos irmãos a `state`.
    // Quando o WhatsApp remove o dispositivo (ex.: você escaneou o QR em outro
    // celular, ou houve conflito de sessão), a Evolution reporta 401 +
    // `disconnectionReasonCode` + `connectionStatus="close"`. Capturamos esses
    // sinais e marcamos `disconnected` para o usuário recriar a sessão.
    const statusCode =
      (d.statusCode as number | undefined) ??
      (d.disconnectionReasonCode as number | undefined) ??
      ((d.disconnectionObject as Record<string, unknown> | undefined)?.output as Record<string, unknown> | undefined)?.statusCode as number | undefined;

    switch (state.toLowerCase()) {
      case 'open':
      case 'connected': {
        await this.sessionsService.markConnected(session.id, phone, profileName);
        this.logger.log(
          `session ${session.id} → connected ` +
          `(phone=${phone ?? '-'} profileName=${profileName ?? '-'})`,
        );
        break;
      }
      case 'close':
      case 'disconnected':
      case 'logging_out':
      case 'conflict':
      case 'device_removed':
      case 'unpaired': {
        // Qualquer estado terminal cai aqui — incluímos os códigos HTTP comuns
        // de disconnect do WhatsApp (401=conflict, 408=timeout, 440=gone).
        await this.sessionsService.updateStatus(session.id, 'disconnected');
        const reason = this.describeDisconnectReason(state, statusCode);
        await this.sessionsService.logEvent(session.id, session.tenantId, 'disconnected', {
          statusCode,
          phone,
          message: reason,
        });
        this.logger.warn(
          `session ${session.id} → disconnected ` +
          `(state=${state} phone=${phone ?? '-'} statusCode=${statusCode ?? '-'})`,
        );
        break;
      }
      case 'connecting':
      case 'qr_screen':
      case 'qr': {
        await this.sessionsService.updateStatus(session.id, 'qrcode_pending');
        await this.sessionsService.logEvent(session.id, session.tenantId, 'qrcode_pending', {
          message: `Estado "${state}" — aguardando QR ser escaneado`,
        });
        break;
      }
      default: {
        // 🔒 M20 — Loga como `warn` (não `debug`) para diagnosticar fácil quando
        // a Evolution introduzir um novo estado que ainda não mapeamos.
        this.logger.warn(
          `session ${session.id}: CONNECTION_UPDATE state="${state}" (não mapeado)`,
        );
        await this.sessionsService.logEvent(session.id, session.tenantId, 'error', {
          statusCode,
          message: `Estado de conexão não mapeado: "${state}"`,
          metadata: data as object,
        });
      }
    }
  }

  /**
   * 🔒 S23 — Traduz códigos HTTP/WhatsApp de disconnect em mensagens
   * legíveis para o log de conexão. Mantém a lista de códigos conhecidos
   * do Baileys/Evolution API:
   *   401 = conflito (outro device conectou com o mesmo número)
   *   402 = não autorizado
   *   403 = banido
   *   408 = timeout
   *   410 = gone (sessão expirou)
   *   428 = connection closed
   *   440 = gone (logged out)
   *   500 = erro interno
   */
  private describeDisconnectReason(state: string, statusCode?: number): string {
    if (statusCode === 401) return `Desconectado (conflito: outro dispositivo conectou com o mesmo número) — state=${state}`;
    if (statusCode === 402 || statusCode === 403) return `Desconectado (não autorizado/banido) — code=${statusCode}`;
    if (statusCode === 408) return `Desconectado (timeout de conexão)`;
    if (statusCode === 410 || statusCode === 440) return `Desconectado (sessão expirou/logout)`;
    if (statusCode === 428) return `Desconectado (conexão fechada)`;
    if (statusCode === 500) return `Desconectado (erro interno do WhatsApp)`;
    return `Desconectado (state=${state}${statusCode ? `, code=${statusCode}` : ''})`;
  }

  /**
   * 🤖 MESSAGES_UPSERT — mensagem recebida de um contato (ou enviada por nós).
   *
   * Payload típico da Evolution (integration WHATSAPP-BAILEYS):
   *   {
   *     "key": {
   *       "id": "3EB04...",                // WA message id
   *       "remoteJid": "5511999999999@s.whatsapp.net",
   *       "fromMe": false,
   *       "participant": "..."             // apenas em grupos
   *     },
   *     "message": {
   *       "conversation": "texto plano",
   *       "extendedTextMessage": { "text": "..." },
   *       "imageMessage": { "caption": "...", "url": "..." },
   *       // ...tipos variados
   *     },
   *     "messageTimestamp": 1700000000,    // unix seconds
   *     "pushName": "Nome do Contato"
   *   }
   *
   * Regras (fixadas para o estágio atual — placeholder temporário):
   *  - Ignora grupos (remoteJid termina em @g.us).
   *  - Ignora mensagens enviadas por nós (key.fromMe === true) — apenas ACK
   *    dessas chega via SEND_MESSAGE/MESSAGES_UPDATE.
   *  - Extrai número do remetente (parte antes do @s.whatsapp.net).
   *  - Upsert do contato por (tenantId, phone).
   *  - Busca conversa existente (contact+session) ou cria nova.
   *  - Persiste a mensagem recebida com idempotência (externalId = WA id).
   *  - Log estruturado (temporário) — o frontend consome via GET /sessions/:id/inbox.
   *  - Resposta placeholder: se EVO_PLACEHOLDER_OWNER_PHONE estiver definido,
   *    só responde a esse número (modo "só responda se for eu"); se vazio,
   *    responde a qualquer número. Em ambos os casos a mensagem recebida é
   *    sempre persistida e logada.
   */
  private async onMessagesUpsert(
    session: { id: string; tenantId: string; sessionName: string; phone?: string | null; status: string },
    data: unknown,
  ) {
    if (typeof data !== 'object' || data === null) return;
    const d = data as Record<string, unknown>;

    const key = d.key as Record<string, unknown> | undefined;
    const remoteJid = key?.remoteJid as string | undefined;
    const fromMe = Boolean(key?.fromMe);
    const externalId = key?.id as string | undefined;
    const pushName = (d.pushName as string | undefined) ?? null;

    // Ignora grupos, status/broadcast e mensagens sem identificação de remetente.
    if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@status@broadcast')) {
      return;
    }
    if (fromMe) {
      // Mensagem que saiu de nós — não action aqui; ACK virá via SEND_MESSAGE.
      return;
    }
    // Só dígitos E.164 do remetente: parte antes do @s.whatsapp.net
    const phone = remoteJid.split('@')[0].replace(/\D/g, '');
    if (!phone) return;

    // Extrai conteúdo textual (TextoPlano, ETM, imagem com caption).
    const msg = d.message as Record<string, unknown> | undefined;
    const text =
      (msg?.conversation as string | undefined) ??
      ((msg?.extendedTextMessage as Record<string, unknown> | undefined)?.text as string | undefined) ??
      ((msg?.imageMessage as Record<string, unknown> | undefined)?.caption as string | undefined) ??
      null;

    const ts = d.messageTimestamp as number | undefined;
    const timestamp = ts ? new Date(ts * 1000) : new Date();

    // Upsert contato + conversa + mensagem numa transação
    let conversationId: string | null = null;
    let messageWasCreated = false;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Upsert contato por (tenantId, phone). Criamos sem nome se não houver
        // pushName — uma futura tool de enriquecimento pode preencher depois.
        const contact = await tx.contact.upsert({
          where: { tenantId_phone: { tenantId: session.tenantId, phone } },
          create: {
            tenantId: session.tenantId,
            phone,
            ...(pushName ? { name: pushName } : {}),
          },
          update: {
            // Atualiza o nome se a Evolution nos deu um pushName novo.
            ...(pushName ? { name: pushName } : {}),
          },
          select: { id: true, name: true },
        });

        // Busca conversa existente aberta para session+contact, ou cria.
        const ua: Prisma.ConversationWhereInput = {
          sessionId: session.id,
          contactId: contact.id,
          // Apenas conversas não-arquivadas (status != 'closed').
          status: { not: 'closed' },
        };
        let conversation = await tx.conversation.findFirst({
          where: ua,
          orderBy: { lastMessageAt: 'desc' },
          select: { id: true },
        });
        if (!conversation) {
          conversation = await tx.conversation.create({
            data: {
              tenantId: session.tenantId,
              contactId: contact.id,
              sessionId: session.id,
              status: 'open',
              lastMessageAt: timestamp,
            },
            select: { id: true },
          });
        } else {
          await tx.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: timestamp },
          });
        }

        // Idempotência: externalId único por (conversationId, externalId).
        // Se já houver mensagem com esse externalId, skip — Evolution pode
        // reenviar o mesmo evento em retry.
        let message: { id: string } | null = null;
        let created = false;
        if (externalId) {
          message = await tx.message.findUnique({
            where: { conversationId_externalId: { conversationId: conversation.id, externalId } },
            select: { id: true },
          });
        }
        if (!message) {
          message = await tx.message.create({
            data: {
              conversationId: conversation.id,
              direction: 'inbound',
              type: text ? 'text' : 'unknown',
              content: text,
              externalId: externalId ?? null,
              status: 'delivered',
              timestamp,
            },
            select: { id: true },
          });
          created = true;
        }
        return { conversationId: conversation.id, message, created, contactName: contact.name };
      }, { timeout: 8000 });

      conversationId = result.conversationId;
      messageWasCreated = result.created;

      // 🪵 Log estruturado (temporário) — o que o usuário pediu para "logar temporariamente".
      this.logger.log(
        `📨 inbound session=${session.id} tenant=${session.tenantId} ` +
        `phone=${phone} name=${result.contactName ?? '-'} ` +
        `text=${JSON.stringify(text ?? `[${msg ? Object.keys(msg)[0] : 'unknown'}]`).slice(0, 280)} ` +
        `conv=${conversationId} ${messageWasCreated ? '(new)' : '(dup)'}`,
      );
    } catch (err) {
      this.logger.error(`onMessagesUpsert: falha ao persistir mensagem de ${phone}: ${(err as Error).message}`);
      // Não propagamos o erro para o controller — já retornamos 200 à Evolution
      // (webhook não pode falhar por problema interno nosso; ela faria retry).
      return;
    }

    // 🤖 Resposta placeholder (apenas se RECENTE; nunca para reprocessamento)
    if (!messageWasCreated) return;
    await this.maybeSendPlaceholder(session, phone, conversationId, text);
  }

  /**
   * Decide e envia a resposta placeholder conforme regras de env:
   *  - EVO_PLACEHOLDER_OWNER_PHONE vazio → responde a qualquer número.
   *  - definido → só responde se o remetente bater com esse número.
   * Persiste a mensagem outbound no DB (para o frontend exibir no inbox)
   * e chama EvolutionService.sendText.
   */
  private async maybeSendPlaceholder(
    session: { id: string; sessionName: string },
    phone: string,
    conversationId: string,
    // incomingText apenas p/ log; não usamos para composição do placeholder
    _incomingText: string | null,
  ) {
    const owner = this.config.get<string>('evolution.placeholderOwnerPhone') ?? '';
    const text = this.config.get<string>('evolution.placeholderText') ?? '';

    // Normaliza ambos para só-dígitos antes de comparar
    const ownerDigits = owner.replace(/\D/g, '');
    const isEligible = !ownerDigits || ownerDigits === phone;

    if (!isEligible) {
      this.logger.log(
        `🤖 placeholder SKIP para ${phone} (owner=${ownerDigits || 'any'} definido e diferente)`,
      );
      return;
    }

    // Persiste a mensagem outbound (placeholder) para o frontend ver no inbox.
    try {
      await this.prisma.message.create({
        data: {
          conversationId,
          direction: 'outbound',
          type: 'text',
          content: text,
          status: 'pending',
          timestamp: new Date(),
        },
        select: { id: true },
      });
    } catch (err) {
      this.logger.warn(`maybeSendPlaceholder: não persistiu outbound: ${(err as Error).message}`);
    }

    // Envia via Evolution API. Failure aqui é só logado — não compromete o 200
    // já retornado à Evolution.
    try {
      const result = await this.evolution.sendText(session.sessionName, { number: phone, text });
      this.logger.log(
        `🤖 placeholder enviado: session=${session.sessionName} to=${phone} key.id=${result?.key?.id ?? '-'} status=${result?.status ?? '-'}`,
      );
    } catch (err) {
      this.logger.error(
        `🤖 placeholder falhou ao enviar para ${phone} via sessão ${session.sessionName}: ${(err as Error).message}`,
      );
    }
  }
}
