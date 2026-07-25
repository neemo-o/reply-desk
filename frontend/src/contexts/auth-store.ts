import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AuthTokens, User } from "@/types/auth";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  /** 🔒 S4 — expiração do access token (segundos desde epoch). Sincronizado
   * entre abas via BroadcastChannel. */
  accessTokenExp: number | null;
  refreshToken: string | null;
  /** 🔒 S4 — ISO date de expiração do refresh token (previsão de "logar de novo"). */
  refreshExpiresAt: string | null;
  tenantId: string | null;
  setSession: (tokens: AuthTokens, user?: User | null) => void;
  setUser: (user: User | null) => void;
  setTenantId: (tenantId: string | null) => void;
  /** Atualiza só a previsão de expiração do refresh (do /auth/me). */
  setSessionExpiry: (refreshExpiresAt: string | null) => void;
  clearSession: () => void;
}

/**
 * Fonte de verdade persistida da sessão (token + usuário).
 * Fica fora do React para que o axios interceptor (fora da árvore de
 * componentes) consiga ler/gravar tokens sem precisar de contexto.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      accessTokenExp: null,
      refreshToken: null,
      refreshExpiresAt: null,
      tenantId: null,
      setSession: (tokens, user) =>
        set((state) => ({
          accessToken: tokens.accessToken,
          accessTokenExp: tokens.accessTokenExp ?? null,
          refreshToken: tokens.refreshToken,
          user: user !== undefined ? user : state.user,
        })),
      setUser: (user) => set({ user }),
      setTenantId: (tenantId) => set({ tenantId }),
      setSessionExpiry: (refreshExpiresAt) => set({ refreshExpiresAt }),
      clearSession: () =>
        set({
          user: null,
          accessToken: null,
          accessTokenExp: null,
          refreshToken: null,
          refreshExpiresAt: null,
          tenantId: null,
        }),
    }),
    {
      name: "replydesk-auth",
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        accessTokenExp: state.accessTokenExp,
        refreshToken: state.refreshToken,
        refreshExpiresAt: state.refreshExpiresAt,
        tenantId: state.tenantId,
      }),
    },
  ),
);
