// 📱 Types compartilhados entre service, hooks e páginas de WhatsApp.
// Espelham o retorno do controller /api/v1/whatsapp/sessions e dos endpoints
// de inbox/logs em /api/v1/whatsapp/sessions/:id/{inbox,logs}.

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
  /** Nome do perfil do WhatsApp (exibido ao lado do número quando existir). */
  profileName?: string | null;
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

/**
 * 🔒 S23 — Versão "safe" retornada pelo backend para agentes (atendentes).
 * Não tem dados sensíveis da Evolution (sessionName, evolutionInstanceId,
 * nem phone). Só informa nome + status + última atividade.
 */
export interface WhatsappSessionSafe {
  id: string;
  name: string;
  status: SessionStatus;
  lastSeen?: string | null;
  createdAt: string;
}

export interface CreateSessionPayload {
  /** 🔒 S23 — `phone` removido: o número vem do webhook ao escanear o QR. */
  name: string;
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

// ─── S23 — Logs de CONEXÃO (SessionEvent) ───────────────────────────

export type SessionEventType =
  | "created"
  | "qrcode_pending"
  | "connected"
  | "disconnected"
  | "error"
  | "logout"
  | "deleted";

export interface SessionEvent {
  id: string;
  type: SessionEventType;
  statusCode?: number | null;
  phone?: string | null;
  message?: string | null;
  createdAt: string;
}
