import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-provider";
import { useRealtimeEvent } from "@/hooks/use-realtime";

/**
 * 🔒 Bug 5 — WS event `bot.sessionCount`.
 * Backend `WhatsappSessionsService.emitBotSessionCount` emite este evento
 * sempre que uma sessão WhatsApp conecta/desconecta, com payload
 * `{ botId, activeSessions }`. Invadima a query de bots para a UI refletir
 * a nova contagem de sessões ativas por bot (cards em /dashboard/bots).
 */
interface BotSessionCountPayload {
  botId: string;
  activeSessions: number;
}

export function useBotSessionCountRealtime() {
  const { isAuthenticated, tenant } = useAuth();
  const queryClient = useQueryClient();

  useRealtimeEvent<BotSessionCountPayload>(
    "bot.sessionCount",
    () => {
      if (!isAuthenticated || !tenant?.id) return;
      // Lista + detalhe do bot específico — ambos mostram contagem.
      queryClient.invalidateQueries({ queryKey: ["bots", tenant.id] });
    },
  );
}
