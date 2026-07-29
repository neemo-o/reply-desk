import { apiClient } from "./api-client";
import type {
  AddContactToListPayload,
  ContactList,
  CreateContactPayload,
  SessionContactListItem,
  SessionSettings,
  UpdateSessionSettingsPayload,
} from "@/types/whatsapp";

/**
 * ⚙️ sessionSettingsService — wrapper HTTP para
 * /whatsapp/sessions/:id/settings[+ /contacts] e /whatsapp/sessions/contacts.
 *
 * 🔒 S24 — Endpoints novos do S24. Mantemos separados do whatsappService
 * pra não inflar o módulo principal.
 */
export const sessionSettingsService = {
  async get(sessionId: string): Promise<SessionSettings> {
    const { data } = await apiClient.get<SessionSettings>(
      `/whatsapp/sessions/${sessionId}/settings`,
    );
    return data;
  },

  async update(
    sessionId: string,
    payload: UpdateSessionSettingsPayload,
  ): Promise<SessionSettings> {
    const { data } = await apiClient.patch<SessionSettings>(
      `/whatsapp/sessions/${sessionId}/settings`,
      payload,
    );
    return data;
  },

  async listContacts(
    sessionId: string,
    list: ContactList,
    opts: { take?: number; cursor?: string } = {},
  ): Promise<SessionContactListItem[]> {
    const { data } = await apiClient.get<SessionContactListItem[]>(
      `/whatsapp/sessions/${sessionId}/settings/contacts`,
      { params: { list, take: opts.take, cursor: opts.cursor } },
    );
    return data;
  },

  async addContact(
    sessionId: string,
    payload: AddContactToListPayload,
  ): Promise<SessionContactListItem> {
    const { data } = await apiClient.post<SessionContactListItem>(
      `/whatsapp/sessions/${sessionId}/settings/contacts`,
      payload,
    );
    return data;
  },

  async removeContact(
    sessionId: string,
    itemId: string,
  ): Promise<{ ok: boolean }> {
    const { data } = await apiClient.delete<{ ok: boolean }>(
      `/whatsapp/sessions/${sessionId}/settings/contacts/${itemId}`,
    );
    return data;
  },

  /**
   * 🔒 S24 — Upsert de contato por número (sem precisar ter mandado
   * mensagem antes). Usado quando o owner quer adicionar à blacklist
   * alguém que nunca conversou.
   */
  async upsertContact(
    payload: CreateContactPayload,
  ): Promise<{
    id: string;
    phone: string;
    name: string | null;
    tenantId: string;
  }> {
    const { data } = await apiClient.post(`/whatsapp/sessions/contacts`, payload);
    return data;
  },
};

/**
 * 🔒 S24 — Conector: enfileira o job `connect-session` para gerar o QR.
 * Equivalente ao /:id/connect — gate que valida bot + lista antes.
 */
export const sessionConnectService = {
  async connect(sessionId: string): Promise<{ id: string; status: string }> {
    const { data } = await apiClient.post<{ id: string; status: string }>(
      `/whatsapp/sessions/${sessionId}/connect`,
    );
    return data;
  },
};
