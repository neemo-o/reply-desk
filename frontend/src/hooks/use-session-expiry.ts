import { useEffect, useState } from "react";
import { useAuthStore } from "@/contexts/auth-store";

/**
 * 🔒 S4 — Hook que expõe o tempo restante da sessão do usuário.
 *
 * - `accessExpiresInSec`: countdown decrescente do access token (15min default).
 *   Atualiza a cada segundo. Baseado em `accessTokenExp` da store (vindo do
 *   backend no login/refresh) — não decodifica o JWT no client para não duplicar
 *   lógica. Se `accessTokenExp` não estiver disponível, faz fallback decodificando.
 * - `refreshExpiresInSec`: tempo até o refresh token expirar (7d default), baseado
 *   em `refreshExpiresAt` (do snapshot /auth/me). É a previsão real de "quanto
 *   tempo até precisar logar de novo".
 * - `isAccessExpired`: true quando o access token já expirou (o interceptor do
 *   axios vai refrescar automaticamente na próxima chamada).
 *
 * Uso:
 *   const { accessExpiresInSec, refreshExpiresInSec, formatted } = useSessionExpiry();
 */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return "expirado";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s.toString().padStart(2, "0")}s`;
  }
  if (seconds < 86_400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m.toString().padStart(2, "0")}m`;
  }
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  return `${d}d ${h}h`;
}

/** Decodifica `exp` de um JWT sem validar a assinatura (somente leitura do payload). */
function decodeJwtExp(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: number;
    };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

export interface SessionExpiry {
  /** Segundos até o access token expirar (countdown em tempo real). */
  accessExpiresInSec: number;
  /** Segundos até o refresh token expirar (previsão de "logar de novo"). */
  refreshExpiresInSec: number;
  /** true se o access token já expirou (axios vai refrescar na próxima chamada). */
  isAccessExpired: boolean;
  /** true se temos uma sessão válida para mostrar. */
  hasSession: boolean;
  /** Texto humano curto: "14m 32s" para access, "6d 14h" para refresh. */
  accessFormatted: string;
  refreshFormatted: string;
}

export function useSessionExpiry(): SessionExpiry {
  const accessToken = useAuthStore((s) => s.accessToken);
  const accessTokenExpFromStore = useAuthStore((s) => s.accessTokenExp);
  const refreshExpiresAt = useAuthStore((s) => s.refreshExpiresAt);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  // Tick a cada 1s para o countdown.
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // Determina o `exp` do access token: prefere o valor persistido (vindo do
  // backend no login/refresh). Se não houver (cliente legado), decodifica o JWT.
  const accessExp =
    accessTokenExpFromStore ?? decodeJwtExp(accessToken);

  const accessExpiresInSec = accessExp ? Math.max(0, accessExp - now) : 0;
  const refreshExpiresInSec = refreshExpiresAt
    ? Math.max(0, Math.floor((new Date(refreshExpiresAt).getTime() - now * 1000) / 1000))
    : 0;

  return {
    accessExpiresInSec,
    refreshExpiresInSec,
    isAccessExpired: accessExpiresInSec === 0,
    hasSession: Boolean(accessToken) && Boolean(refreshExpiresAt),
    accessFormatted: formatDuration(accessExpiresInSec),
    refreshFormatted: formatDuration(refreshExpiresInSec),
  };
}

export { formatDuration };
