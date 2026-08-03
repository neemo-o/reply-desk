import { Injectable } from '@nestjs/common';

export type IncomingMsgType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'list_response'
  | 'buttons_response'
  | 'reaction'
  | 'poll_update'
  | 'unknown';

export interface ParsedIncomingMessage {
  type: IncomingMsgType;
  /// Identificador do item respondido (list row id / button id) — preenchido
  /// para list_response e buttons_response.
  selectedId?: string;
  /// Texto puro da mensagem (caption para mídia, valor p/ reação/poll).
  text?: string;
  /// Emoji da reação.
  reaction?: string;
  /// Telefone recebido no vCard (contact).
  contactPhone?: string;
  /// Nome do contato no vCard.
  contactName?: string;
  /// Posição/latitude-longitude para location.
  latitude?: number;
  longitude?: number;
  /// Nome da enquete (poll) ou opção votada.
  pollName?: string;
  /// Opção votada (pollUpdateMessage) — string simples.
  pollVotes?: string[];
  /// URL da mídia (não baixamos — apenas referência).
  mediaUrl?: string;
  /// MIME tipo da mídia.
  mediaMime?: string;
}

/**
 * 🤖 Parser de mensagens recebidas (Baileys message payload).
 *
 * Entry-point: parseMessage(rawMessage, key) — recebe `message` cru da Evolution.
 * Tipos relevantes para o motor de decisão:
 *   - extendedTextMessage / conversation        → text
 *   - listResponseMessage                       → list_response (selectedId)
 *   - buttonsResponseMessage                    → buttons_response (selectedId)
 * Os demais são registrados no MessageLog e caem no fallback do bot.
 */
@Injectable()
export class EvolutionMessageParser {
  parse(raw: unknown, key?: { fromMe?: boolean; remoteJid?: string }): ParsedIncomingMessage {
    const obj = (raw ?? {}) as Record<string, unknown>;
    const conversation = obj.conversation as string | undefined;
    const ext = obj.extendedTextMessage as Record<string, unknown> | undefined;
    const image = obj.imageMessage as Record<string, unknown> | undefined;
    const video = obj.videoMessage as Record<string, unknown> | undefined;
    const audio = obj.audioMessage as Record<string, unknown> | undefined;
    const doc = obj.documentMessage as Record<string, unknown> | undefined;
    const sticker = obj.stickerMessage as Record<string, unknown> | undefined;
    const location = obj.locationMessage as Record<string, unknown> | undefined;
    const contact = obj.contactMessage as Record<string, unknown> | undefined;
    const listResp = obj.listResponseMessage as Record<string, unknown> | undefined;
    const buttonsResp = obj.buttonsResponseMessage as Record<string, unknown> | undefined;
    const reaction = obj.reactionMessage as Record<string, unknown> | undefined;
    const pollUpdate = obj.pollUpdateMessage as Record<string, unknown> | undefined;

    if (listResp) {
      const singleSelect = listResp.singleSelectReply as Record<string, unknown> | undefined;
      return {
        type: 'list_response',
        selectedId:
          (listResp.listResponseMessageSingleSelectReturnId as string | undefined) ??
          (singleSelect?.selectedRowId as string | undefined),
        text:
          (listResp.listResponseMessageSingleSelectReplyText as string | undefined) ??
          (singleSelect?.selectedRowId as string | undefined),
      };
    }

    if (buttonsResp) {
      return {
        type: 'buttons_response',
        selectedId: (buttonsResp.selectedButtonId as string | undefined) ?? undefined,
        text: (buttonsResp.selectedButtonId as string | undefined) ?? undefined,
      };
    }

    if (conversation || ext) {
      return { type: 'text', text: (conversation ?? ext?.text) as string | undefined };
    }

    if (image) {
      return {
        type: 'image',
        text: (image.caption as string | undefined) ?? undefined,
        mediaUrl: (image.url as string | undefined) ?? undefined,
        mediaMime: (image.mimetype as string | undefined) ?? undefined,
      };
    }
    if (video) {
      return {
        type: 'video',
        text: (video.caption as string | undefined) ?? undefined,
        mediaUrl: (video.url as string | undefined) ?? undefined,
        mediaMime: (video.mimetype as string | undefined) ?? undefined,
      };
    }
    if (audio) {
      return {
        type: 'audio',
        mediaUrl: (audio.url as string | undefined) ?? undefined,
        mediaMime: (audio.mimetype as string | undefined) ?? undefined,
      };
    }
    if (doc) {
      return {
        type: 'document',
        mediaUrl: (doc.url as string | undefined) ?? undefined,
        mediaMime: (doc.mimetype as string | undefined) ?? undefined,
      };
    }
    if (sticker) {
      return {
        type: 'sticker',
        mediaUrl: (sticker.url as string | undefined) ?? undefined,
      };
    }
    if (location) {
      return {
        type: 'location',
        latitude: (location.degreesLatitude as number | undefined) ?? (location.latitude as number | undefined),
        longitude: (location.degreesLongitude as number | undefined) ?? (location.longitude as number | undefined),
      };
    }
    if (contact) {
      const displayName = (contact.displayName as string | undefined) ?? undefined;
      const vcard = (contact.vcard as string | undefined) ?? undefined;
      const phone = vcard ? this.extractPhoneFromVcard(vcard) : undefined;
      return { type: 'contact', contactName: displayName, contactPhone: phone };
    }
    if (reaction) {
      return { type: 'reaction', reaction: (reaction.text as string | undefined) ?? undefined, text: undefined };
    }
    if (pollUpdate) {
      const name = (pollUpdate.name as string | undefined) ?? undefined;
      const votesRaw = pollUpdate.votes as unknown;
      const votes = Array.isArray(votesRaw) ? (votesRaw as string[]) : [];
      return { type: 'poll_update', pollName: name, pollVotes: votes };
    }

    return { type: 'unknown' };
  }

  private extractPhoneFromVcard(vcard: string): string | undefined {
    const m = vcard.match(/TEL[^:]*:([^\r\n]+)/i);
    return m ? m[1].trim().replace(/\D/g, '') : undefined;
  }

  /** phone E.164 (somente dígitos). */
  extractPhone(remoteJid: string | undefined): string | null {
    if (!remoteJid) return null;
    return remoteJid.split('@')[0].replace(/\D/g, '') || null;
  }

  isGroup(remoteJid: string | undefined): boolean {
    return Boolean(remoteJid?.endsWith('@g.us'));
  }

  isBroadcast(remoteJid: string | undefined): boolean {
    return Boolean(remoteJid?.endsWith('@status@broadcast'));
  }
}
