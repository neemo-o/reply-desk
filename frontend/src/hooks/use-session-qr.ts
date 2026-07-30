import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { whatsappService } from "@/services/whatsapp-service";
import { useAuth } from "@/contexts/auth-provider";
import type { QrCodeResponse } from "@/types/whatsapp";

/**
 * 📱 Hook unificado para o QR Code da sessão.
 *
 * Substitui o loop manual de polling que existia dentro do `SessionDetail`.
 * Resolve os problemas:
 *  - 🔴 CRÍTICO 1 — Race condition entre polling manual e invalidação do React Query
 *  - 🔴 CRÍTICO 2 — Polling duplicado em React 18 StrictMode
 *  - 🔴 CRÍTICO 4 — `qr_expired` demora até 7s para refletir
 *  - 🟠 MÉDIO 7 — Polling não cancelado em todas as transições
 *  - 🟠 MÉDIO 9 — Falta de feedback de erro
 *  - 🟠 MÉDIO 10 — Countdown vinculado ao polling (congela em erro)
 *  - 🟡 BAIXO 15 — Sem retry/backoff no polling
 *
 * Estratégia:
 *  - `useQuery` com `refetchInterval` dinâmico controlado pelo estado
 *    retornado (para em estados terminais, aplica backoff em erro).
 *  - Countdown desacoplado do polling: usa `setInterval(1s)` independente.
 *  - Single source of truth: o cache do React Query é compartilhado entre
 *    todas as montagens do componente (StrictMode-safe).
 */
export function useSessionQr(
  sessionId: string,
  enabled: boolean,
) {
  const { tenant } = useAuth();
  const consecutiveErrorsRef = useRef(0);
  const [qrSecondsLeft, setQrSecondsLeft] = useState(60);

  const query = useQuery<QrCodeResponse>({
    queryKey: ["whatsapp", tenant?.id, "session-qr", sessionId],
    queryFn: async () => {
      try {
        const data = await whatsappService.getQr(sessionId);
        consecutiveErrorsRef.current = 0;
        return data;
      } catch (err) {
        consecutiveErrorsRef.current += 1;
        throw err;
      }
    },
    enabled,
    staleTime: 1_500,
    retry: (failureCount) => failureCount < 5,
    retryDelay: (attempt) => Math.min(16_000, 1_000 * 2 ** attempt),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (data?.connected || data?.qrExpired) return false;
      if (q.state.error) {
        const errCount = consecutiveErrorsRef.current;
        // 🔒 S25-b — Após 3 erros consecutivos, paramos a polling em silêncio.
        // Caso contrário continuamos batendo /qr (que incrementa qrAttempts)
        // mesmo quando o backend está rejeitando — combinando com o bug do
        // logout, podia levar direto a qr_expired.
        if (errCount >= 3) return false;
        return Math.min(16_000, 1_000 * 2 ** (errCount - 1));
      }
      return 2_000;
    },
    refetchIntervalInBackground: false,
  });

  // 🕐 Countdown em tempo real (1s tick), independente do polling.
  // Para imediatamente em estados terminais.
  useEffect(() => {
    if (!enabled || query.data?.connected || query.data?.qrExpired) {
      setQrSecondsLeft(0);
      return;
    }
    const id = setInterval(() => {
      setQrSecondsLeft((s) => (s <= 0 ? 60 : s - 1));
    }, 1_000);
    return () => clearInterval(id);
  }, [enabled, query.data?.connected, query.data?.qrExpired]);

  // 🔄 Reseta countdown quando um QR novo chega (qrcode diferente do anterior).
  const lastQrRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const current = query.data?.qrcode;
    if (current && current !== lastQrRef.current) {
      lastQrRef.current = current;
      setQrSecondsLeft(60);
    }
  }, [query.data?.qrcode]);

  return {
    ...query,
    qrSecondsLeft,
  };
}
