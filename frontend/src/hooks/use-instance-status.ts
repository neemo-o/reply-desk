import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/services/api-client";
import { useAuth } from "@/contexts/auth-provider";

export interface InstanceSession {
  id: string;
  name: string;
  sessionName: string;
  phone: string | null;
  profileName: string | null;
  persistedStatus: string;
  liveState: string | null;
  isConnected: boolean;
}

export interface InstanceStatusResponse {
  status: "connected" | "disconnected" | "partial" | "unknown";
  sessions: InstanceSession[];
  updatedAt: string;
}

async function fetchInstanceStatus(): Promise<InstanceStatusResponse> {
  const { data } = await apiClient.get<InstanceStatusResponse>("/instance/status");
  return data;
}

/**
 * Hook para consulta da instância WhatsApp do tenant (REST polling ou manual).
 * Periodicamente refetch a cada 30s; WebSocket `instance.status` pode invalida.
 */
export function useInstanceStatus(options: { refetchInterval?: number } = {}) {
  const { isAuthenticated, tenant } = useAuth();
  return useQuery({
    queryKey: ["instance", "status", tenant?.id],
    queryFn: fetchInstanceStatus,
    enabled: isAuthenticated && Boolean(tenant),
    refetchIntervalInBackground: false,
    refetchInterval: options.refetchInterval ?? 30_000,
    staleTime: 10_000,
  });
}