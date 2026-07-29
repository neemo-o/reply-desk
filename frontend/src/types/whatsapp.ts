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
    // 🔒 S24 — campos adicionados pela feature de configuração
    contactFilterMode?: ContactFilterMode;
    activeBotId?: string | null;
    activeBotVersionId?: string | null;
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
  // 🔒 S24 — config obrigatória na criação.
  activeBotId: string;
  activeBotVersionId?: string;
  contactFilterMode?: ContactFilterMode;
}

// 🔒 S24-b — 'blacklist' deixou de ser um modo (é banimento, sempre ativo
// quando preenchido). O modo só indica se a whitelist está ATIVA
// (`"whitelist"`) ou INATIVA (`"none"`).
export type ContactFilterMode = "none" | "whitelist";
export type ContactList = "whitelist" | "blacklist";

export const CONTACT_FILTER_LABELS: Record<ContactFilterMode, string> = {
  none:
    "Sem whitelist (só blacklist bloqueia, se houver)",
  whitelist:
    "Whitelist ativa (só responde quem está na lista; vazia = responde qualquer um)",
};

/**
 * 🔒 S24-b — Normaliza valores legados do enum (ex.: `'blacklist'` salvo
 * antes da mudança → `'none'`). Mesmo normalizador que o backend usa.
 */
export function normalizeContactFilterMode(raw: unknown): ContactFilterMode {
  return raw === "whitelist" ? "whitelist" : "none";
}

// 🔒 S24 — Settings completas da sessão (resposta de GET/PATCH
// /whatsapp/sessions/:id/settings). Alguns campos são só leitura
// nesta versão (autoReconnect, ignoreGroups, etc.).
export interface SessionSettings {
  id: string;
  contactFilterMode: ContactFilterMode;
  activeBotId: string | null;
  activeBotVersionId: string | null;
  autoReconnect: boolean;
  ignoreGroups: boolean;
  readMessages: boolean;
  typingIndicator: boolean;
  presenceUpdate: boolean;
  webhookUrl: string | null;
}

export interface UpdateSessionSettingsPayload {
  contactFilterMode?: ContactFilterMode;
  activeBotId?: string | null;
  activeBotVersionId?: string | null;
  autoReconnect?: boolean;
  ignoreGroups?: boolean;
  readMessages?: boolean;
  typingIndicator?: boolean;
  presenceUpdate?: boolean;
  webhookUrl?: string;
}

/**
 * 🔒 S24 — Item de lista (whitelist|blacklist) com o contato embutido.
 * Devolvido por GET /whatsapp/sessions/:id/settings/contacts.
 */
export interface SessionContactListItem {
  id: string;
  list: ContactList;
  note: string | null;
  createdAt: string;
  contact: {
    id: string;
    phone: string;
    name: string | null;
    email?: string | null;
    avatar?: string | null;
  };
}

/** 🔒 S24 — POST /whatsapp/sessions/:id/settings/contacts */
export interface AddContactToListPayload {
  contactId: string;
  list: ContactList;
  note?: string;
}

/** 🔒 S24 — POST /whatsapp/sessions/contacts (cria contato manual) */
export interface CreateContactPayload {
  phone: string;
  name?: string;
  notes?: string;
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
  | "deleted"
  | "updated";

export interface SessionEvent {
  id: string;
  type: SessionEventType;
  statusCode?: number | null;
  phone?: string | null;
  message?: string | null;
  createdAt: string;
}
