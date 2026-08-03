import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/auth-provider";
import { realtimeClient } from "@/lib/realtime-client";

/**
 * Conecta automaticamente o WebSocket quando autenticado e inscrito no tenant.
 * Escuta o evento `event` e repassa em `handler`.
 *
 * Re-conecta (subscribe) automaticamente se o tenant mudar.
 *
 * Use junto com TanStack Query (refetchInterval fallback) para robustez.
 */
export function useRealtimeEvent<T = unknown>(
  event: "instance.status" | "broadcast.progress" | "bot.session",
  handler: (payload: T) => void,
) {
  const { isAuthenticated, tenant } = useAuth();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!isAuthenticated || !tenant?.id) return;
    realtimeClient.connect();
    realtimeClient.subscribeTenant(tenant.id);

    const s = realtimeClient.socket();

    const onEvent = (payload: T) => handlerRef.current?.(payload);
    s.on(event, onEvent);

    return () => {
      s.off(event, onEvent);
    };
  }, [isAuthenticated, tenant?.id, event]);
}
