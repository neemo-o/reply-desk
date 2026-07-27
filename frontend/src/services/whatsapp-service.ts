import { apiClient } from "./api-client";
import type {
  CreateSessionPayload,
  InboxMessage,
  QrCodeResponse,
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
 *   GET    /whatsapp/sessions/:id/inbox    🪵 inbox temporário (mensagens)
 *   POST   /whatsapp/sessions/:id/reconnect
 *   POST   /whatsapp/sessions/:id/logout
 *   DELETE /whatsapp/sessions/:id          delete permanente
 */
export const whatsappService = {
  async list(): Promise<WhatsappSession[]> {
    const { data } = await apiClient.get<WhatsappSession[]>("/whatsapp/sessions");
    return data;
  },

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
};
