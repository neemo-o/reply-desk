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

    this.logger.debug(
      `[${normalizedEvent}] session=${session.id} tenant=${session.tenantId} state=${session.status}`,
    );

    switch (normalizedEvent) {
      case 'CONNECTION_UPDATE':
        await this.onConnectionUpdate(session, raw.data);
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
        await this.onMessagesUpsert(session, raw.data);
        break;
      case 'MESSAGES_UPDATE':
      case 'MESSAGES_DELETE':
      case 'SEND_MESSAGE':
        // 🔌 TODO: marcar mensagens enviadas como ACK no banco.
        this.logger.debug(
          `[${normalizedEvent}] message ack event para sessão ${session.id} — TBD`,
        );
        break;
      case 'CONTACTS_UPSERT':
      case 'PRESENCE_UPDATE':
        // informações auxiliares — podemos enriquecer contatos no futuro.
        this.logger.debug(`[${normalizedEvent}] auxiliar event, sem ação persistida`);
        break;
      default:
        // 🔒 M20 — Loga em `warn` (não `debug`) para facilitar diagnóstico
        // quando a Evolution enviar um evento novo que ainda não mapeamos.
        this.logger.warn(`[${normalizedEvent}] evento não mapeado (original="${event}") — ignorado`);
    }

    return { ok: true };
  }

  /**
   * CONNECTION_UPDATE — atualiza status da sessão refletindo a conexão
   * real do WhatsApp na Evolution.
   *
   * data pode conter:
   *   {
   *     state: 'open' | 'close' | 'connecting' | ...,
   *     statusCode?: 401 | 440 | 408 | ...,
   *     disconnectionReasonCode?: 401,
   *     disconnectionObject?: { ... },
   *   }
   * Em alguns fluxos o estado é `status` em vez de `state` — aceitamos ambos.
   */
  private async onConnectionUpdate(
    session: { id: string; sessionName: string },
    data: unknown,
  ) {
    if (typeof data !== 'object' || data === null) return;
    const d = data as Record<string, unknown>;
    const state = (d.state ?? d.status) as string | undefined;
    if (!state) return;

    // phone: alguns fluxos trazem em data.wid.user ou data.user
    const phone =
      ((d.wid as Record<string, unknown> | undefined)?.user as string | undefined) ??
      (d.user as string | undefined);

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
      case 'connected':
        await this.sessionsService.markConnected(session.id, phone);
        this.logger.log(`session ${session.id} → connected (phone=${phone ?? '-'})`);
        break;
      case 'close':
      case 'disconnected':
      case 'logging_out':
      case 'conflict':
      case 'device_removed':
      case 'unpaired':
        // Qualquer estado terminal cai aqui — incluímos os códigos HTTP comuns
        // de disconnect do WhatsApp (401=conflict, 408=timeout, 440=gone).
        await this.sessionsService.updateStatus(session.id, 'disconnected');
        this.logger.warn(
          `session ${session.id} → disconnected ` +
          `(state=${state} phone=${phone ?? '-'} statusCode=${statusCode ?? '-'})`,
        );
        break;
      case 'connecting':
      case 'qr_screen':
      case 'qr':
        await this.sessionsService.updateStatus(session.id, 'qrcode_pending');
        break;
      default:
        // 🔒 M20 — Loga como `warn` (não `debug`) para diagnosticar fácil quando
        // a Evolution introduzir um novo estado que ainda não mapeamos.
        this.logger.warn(
          `session ${session.id}: CONNECTION_UPDATE state="${state}" (não mapeado)`,
        );
    }
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
