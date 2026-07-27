// 📱 Types compartilhados entre service, hooks e páginas de WhatsApp.
// Espelham o retorno do controller /api/v1/whatsapp/sessions e do inbox
// em /api/v1/whatsapp/sessions/:id/inbox.

export type SessionStatus =
  | "disconnected"
  | "connecting"
  | "qrcode_pending"
  | "connected";

export interface WhatsappSession {
  id: string;
  tenantId?: string;
  name: string;
  phone?: string | null;
  sessionName: string;
  evolutionInstanceId?: string | null;
  status: SessionStatus;
  lastSeen?: string | null;
  createdAt: string;
  updatedAt?: string;
  settings?: {
    webhookUrl?: string | null;
    autoReconnect?: boolean;
    ignoreGroups?: boolean;
  } | null;
}

export interface CreateSessionPayload {
  name: string;
  phone?: string;
}

export interface QrCodeResponse {
  /** true = sessão já conectada; não precisa mostrar QR. */
  connected: boolean;
  /** base64 PNG do QR, ou já com prefixo data:image/png;base64,... */
  qrcode?: string;
  /** texto do QR (alguns clients Evolution retornam só `code`) */
  code?: string;
  /** código de pareamento (WhatsApp multi-device) */
  pairingCode?: string;
}

// ─── Inbox (log temporário de mensagens) ────────────────────────────

export type MessageDirection = "inbound" | "outbound";
export type MessageType = "text" | "image" | "audio" | "video" | "document" | "unknown";
export type MessageStatus = "pending" | "sent" | "delivered" | "read" | "failed";

export interface InboxMessage {
  id: string;
  direction: MessageDirection;
  type: MessageType;
  content: string | null;
  status: MessageStatus;
  timestamp: string;
  conversation: {
    id: string;
    status: string;
    contact: {
      id: string;
      phone: string;
      name?: string | null;
      avatar?: string | null;
    };
  };
}
