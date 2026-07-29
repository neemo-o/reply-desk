import { useQuery } from "@tanstack/react-query";
import { botsService } from "@/services/bots-service";
import { useAuth } from "@/contexts/auth-provider";

/**
 * 🤖 useBots — lista bots do tenant atual.
 * Filtramos no cliente os publicados (status='active') — o backend já
 * aceita qualquer um no GET, mas o S24 só nos interessa os ativos.
 */
export function useBots(options: { onlyActive?: boolean } = {}) {
  const { isAuthenticated, tenant } = useAuth();
  return useQuery({
    queryKey: ["bots", tenant?.id, options.onlyActive],
    queryFn: async () => {
      const all = await botsService.list();
      return options.onlyActive ? all.filter((b) => b.status === "active") : all;
    },
    enabled: isAuthenticated && Boolean(tenant),
    staleTime: 30_000,
  });
}
