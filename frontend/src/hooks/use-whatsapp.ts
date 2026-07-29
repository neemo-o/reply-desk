import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  whatsappService,
} from "@/services/whatsapp-service";
import type { CreateSessionPayload, WhatsappSession } from "@/types/whatsapp";
import { useAuth } from "@/contexts/auth-provider";
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/lib/api-errors";

/**
 * 📱 Hooks de WhatsApp — sessões + inbox + logs de conexão.
 *
 * Padrão: queryKey começa com ["whatsapp", ...] e invalida-se nos
 * mutations. O inbox e os logs usam polling de 3s enquanto houver uma
 * sessão selecionada, simulando log em tempo real das mensagens/eventos.
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
      toast.success("Reconexão iniciada — QR Code disponível.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível reconectar."));
    },
  });
}

/**
 * 🔒 S23 — "Logout" agora é "Desconectar (trocar celular)": gera QR novo.
 * O toast explica: a sessão volta para qrcode_pending e o frontend já
 * começa a pollar o QR automaticamente.
 */
export function useLogoutSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => whatsappService.logout(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp"] });
      toast.success("Desconectado. Escaneie o QR Code novo para conectar outro número.");
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
 * 🔒 S24-b — Renomeia o nome de exibição da sessão. Atualiza o cache
 * da lista de sessões e do detalhe pra refletir o novo nome sem precisar
 * recarregar.
 */
export function useRenameSession() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: (args: { id: string; name: string }) =>
      whatsappService.rename(args.id, args.name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp"] });
      queryClient.setQueryData<WhatsappSession[]>(
        [...WHATSAPP_KEY(tenant?.id), "sessions"],
        (prev) =>
          prev?.map((s) => (s.id === data.id ? { ...s, name: data.name } : s)),
      );
      toast.success("Sessão renomeada.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível renomear a sessão."));
    },
  });
}

/**
 * 🪵 useWhatsappInbox — polling das últimas mensagens da sessão.
 *
 * 🔒 S23 — Reservado para visão administrativa (owner/admin). A página de
 * detalhes agora usa useSessionLogs para mostrar logs de CONEXÃO.
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

/**
 * 🪵 S23 — Logs de CONEXÃO da sessão (SessionEvent). Substitui o uso do
 * inbox como "log temporário". Polling de 3s para acompanhar transições
 * (qrcode_pending → connected, disconnected, etc.) em tempo real.
 */
export function useSessionLogs(
  sessionId: string | null | undefined,
  options: { enabled?: boolean; take?: number } = {},
) {
  const { isAuthenticated, tenant } = useAuth();
  const enabled =
    options.enabled !== false && isAuthenticated && Boolean(tenant) && Boolean(sessionId);

  return useQuery({
    queryKey: [...WHATSAPP_KEY(tenant?.id), "logs", sessionId, options.take ?? 50],
    queryFn: () => whatsappService.getLogs(sessionId as string, { take: options.take ?? 50 }),
    enabled,
    refetchInterval: 3_000,
  });
}
