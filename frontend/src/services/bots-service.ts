import { apiClient } from "./api-client";
import type { Bot } from "@/types/bots";

/**
 * 🤖 botsService — wrapper HTTP para /bots.
 *
 * 🔒 S24 — O S24 usa este service pra listar bots publicados (status='active')
 * e oferecer ao owner escolher um bot ativo na hora de criar/configurar
 * uma sessão. Não criamos/publish bots via UI neste momento — o S24 só
 * CONSOME a lista.
 */
export const botsService = {
  async list(): Promise<Bot[]> {
    const { data } = await apiClient.get<Bot[]>("/bots");
    return data;
  },
};
