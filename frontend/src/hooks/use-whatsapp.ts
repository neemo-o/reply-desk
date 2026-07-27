import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  whatsappService,
} from "@/services/whatsapp-service";
import type { CreateSessionPayload } from "@/types/whatsapp";
import { useAuth } from "@/contexts/auth-provider";
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/lib/api-errors";

/**
 * 📱 Hooks de WhatsApp — sessões + inbox.
 *
 * Padrão: queryKey começa com ["whatsapp", ...] e invalida-se nos
 * mutations. O inbox usa polling de 3s enquanto houver uma sessão
 * selecionada, simulando log em tempo real das mensagens.
 */

const WHATSAPP_KEY = (tenantId: string | undefined) => ["whatsapp", tenantId];

export function useWhatsappSessions() {
  const { isAuthenticated, tenant } = useAuth();
  return useQuery({
    queryKey: [...WHATSAPP_KEY(tenant?.id), "sessions"],
    queryFn: () => whatsappService.list(),
    enabled: isAuthenticated && Boolean(tenant),
    refetchInterval: 5_000, // atualiza status (connecting → connected) sem reload
  });
}

export function useWhatsappSession(sessionId: string | null | undefined) {
  const { isAuthenticated, tenant } = useAuth();
  return useQuery({
    queryKey: [...WHATSAPP_KEY(tenant?.id), "session", sessionId],
    queryFn: () => whatsappService.getOne(sessionId as string),
    enabled: isAuthenticated && Boolean(tenant) && Boolean(sessionId),
    refetchInterval: 5_000,
  });
}

export function useCreateWhatsappSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSessionPayload) => whatsappService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp"] });
      toast.success("Sessão criada. Escaneie o QR para conectar.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível criar a sessão."));
    },
  });
}

export function useReconnectSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => whatsappService.reconnect(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp"] });
      toast.success("Reconexão iniciada.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível reconectar."));
    },
  });
}

export function useLogoutSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => whatsappService.logout(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp"] });
      toast.success("Sessão desconectada.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível desconectar a sessão."));
    },
  });
}

export function useDeleteSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => whatsappService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp"] });
      toast.success("Sessão excluída.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível excluir a sessão."));
    },
  });
}

/**
 * 🪵 useWhatsappInbox — polling das últimas mensagens da sessão.
 *
 * Usado pela página `/dashboard/whatsapp` para mostrar um log em tempo
 * real das mensagens recebidas/envidas. Polling de 3s é adequado para o
 * modo "temporário" — quando mensagens virarem um módulo completo, o
 * ideal é migrar para WebSocket/SSE.
 */
export function useWhatsappInbox(
  sessionId: string | null | undefined,
  options: { enabled?: boolean; take?: number } = {},
) {
  const { isAuthenticated, tenant } = useAuth();
  const enabled =
    options.enabled !== false && isAuthenticated && Boolean(tenant) && Boolean(sessionId);

  return useQuery({
    queryKey: [...WHATSAPP_KEY(tenant?.id), "inbox", sessionId, options.take ?? 50],
    queryFn: () => whatsappService.getInbox(sessionId as string, { take: options.take ?? 50 }),
    enabled,
    refetchInterval: 3_000,
  });
}
