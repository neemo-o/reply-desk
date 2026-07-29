import { apiClient } from "./api-client";
import type {
  CreateSessionPayload,
  InboxMessage,
  QrCodeResponse,
  SessionEvent,
  WhatsappSession,
} from "@/types/whatsapp";
/**
 * 📱 whatsappService — wrapper HTTP para /whatsapp/sessions.
 *
 * Endpoints disponíveis (controller WhatsappSessionsController):
 *   GET    /whatsapp/sessions              listar
 *   POST   /whatsapp/sessions              criar (enfileira connect-session)
 *   GET    /whatsapp/sessions/:id          detalhe
 *   GET    /whatsapp/sessions/:id/qr       QR atual (nunca persistido)
 *   GET    /whatsapp/sessions/:id/inbox    🪵 inbox de mensagens
 *   GET    /whatsapp/sessions/:id/logs     🪵 S23 — logs de conexão
 *   POST   /whatsapp/sessions/:id/reconnect
 *   POST   /whatsapp/sessions/:id/logout
 *   DELETE /whatsapp/sessions/:id          delete permanente
 */
export const whatsappService = {
  async list(): Promise<WhatsappSession[]> {
    const { data } = await apiClient.get<WhatsappSession[]>("/whatsapp/sessions");
    return data;
  },

  /**
   * 🔒 S23 — `payload` agora só tem `name` (sem phone).
   */
  async create(payload: CreateSessionPayload): Promise<WhatsappSession> {
    const { data } = await apiClient.post<WhatsappSession>(
      "/whatsapp/sessions",
      payload,
    );
    return data;
  },

  async getOne(id: string): Promise<WhatsappSession> {
    const { data } = await apiClient.get<WhatsappSession>(
      `/whatsapp/sessions/${id}`,
    );
    return data;
  },

  async getQr(id: string): Promise<QrCodeResponse> {
    const { data } = await apiClient.get<QrCodeResponse>(
      `/whatsapp/sessions/${id}/qr`,
    );
    return data;
  },

  async getInbox(id: string, opts: { take?: number; cursor?: string } = {}): Promise<InboxMessage[]> {
    const { data } = await apiClient.get<InboxMessage[]>(
      `/whatsapp/sessions/${id}/inbox`,
      { params: { take: opts.take, cursor: opts.cursor } },
    );
    return data;
  },

  /**
   * 🪵 S23 — Logs de CONEXÃO da sessão (SessionEvent). Substitui o uso do
   * inbox como "log temporário" na página de detalhes.
   */
  async getLogs(id: string, opts: { take?: number; cursor?: string } = {}): Promise<SessionEvent[]> {
    const { data } = await apiClient.get<SessionEvent[]>(
      `/whatsapp/sessions/${id}/logs`,
      { params: { take: opts.take, cursor: opts.cursor } },
    );
    return data;
  },

  async reconnect(id: string): Promise<{ status: string }> {
    const { data } = await apiClient.post<{ status: string }>(
      `/whatsapp/sessions/${id}/reconnect`,
    );
    return data;
  },

  async logout(id: string): Promise<{ status: string }> {
    const { data } = await apiClient.post<{ status: string }>(
      `/whatsapp/sessions/${id}/logout`,
    );
    return data;
  },

  async delete(id: string): Promise<{ success: boolean }> {
    const { data } = await apiClient.delete<{ success: boolean }>(
      `/whatsapp/sessions/${id}`,
    );
    return data;
  },

  /**
   * 🔒 S24-b — Renomeia o nome de exibição da sessão. Não mexe em
   * sessionName/phone; apenas atualiza o `name`.
   */
  async rename(id: string, name: string): Promise<{ id: string; name: string }> {
    const { data } = await apiClient.patch<{ id: string; name: string }>(
      `/whatsapp/sessions/${id}/name`,
      { name },
    );
    return data;
  },
};
