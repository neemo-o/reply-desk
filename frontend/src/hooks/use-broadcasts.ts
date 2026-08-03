import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { broadcastsService } from "@/services/broadcasts-service";
import { useAuth } from "@/contexts/auth-provider";
import { extractApiErrorMessage } from "@/lib/api-errors";
import type { CreateBroadcastPayload } from "@/types/broadcast";

export function useBroadcasts() {
  const { isAuthenticated, tenant } = useAuth();
  return useQuery({
    queryKey: ["broadcasts", tenant?.id],
    queryFn: broadcastsService.list,
    enabled: isAuthenticated && Boolean(tenant),
    staleTime: 15_000,
  });
}

export function useBroadcastProgress(id: string) {
  const { isAuthenticated, tenant } = useAuth();
  return useQuery({
    queryKey: ["broadcasts", tenant?.id, id, "progress"],
    queryFn: () => broadcastsService.getProgress(id),
    enabled: isAuthenticated && Boolean(tenant) && Boolean(id),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      if (s === "running" || s === "scheduled") return 5_000;
      return false;
    },
  });
}

export function useCreateBroadcast() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: (payload: CreateBroadcastPayload) => broadcastsService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["broadcasts", tenant?.id] });
      toast.success("Broadcast agendado.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível agendar o broadcast."));
    },
  });
}

export function usePauseBroadcast() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: (id: string) => broadcastsService.pause(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["broadcasts", tenant?.id] });
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err));
    },
  });
}

export function useResumeBroadcast() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: (id: string) => broadcastsService.resume(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["broadcasts", tenant?.id] });
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err));
    },
  });
}