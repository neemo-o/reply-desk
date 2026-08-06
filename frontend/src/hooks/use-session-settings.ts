import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sessionSettingsService, sessionConnectService } from "@/services/session-settings-service";
import { useAuth } from "@/contexts/auth-provider";
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/lib/api-errors";
import type {
  AddContactToListPayload,
  ContactList,
  UpdateSessionSettingsPayload,
} from "@/types/whatsapp";

const KEY = (tenantId: string | undefined) => ["session-settings", tenantId];

export function useSessionSettings(sessionId: string | null | undefined) {
  const { isAuthenticated, tenant } = useAuth();
  return useQuery({
    queryKey: [...KEY(tenant?.id), sessionId],
    queryFn: () => sessionSettingsService.get(sessionId as string),
    enabled: isAuthenticated && Boolean(tenant) && Boolean(sessionId),
    staleTime: 30_000,
  });
}

export function useUpdateSessionSettings(sessionId: string) {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: (payload: UpdateSessionSettingsPayload) =>
      sessionSettingsService.update(sessionId, payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp"] });
      queryClient.setQueryData([...KEY(tenant?.id), sessionId], data);
      toast.success("Configurações salvas.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível salvar as configurações."));
    },
  });
}

export function useSessionContacts(sessionId: string | null | undefined, list: ContactList) {
  const { isAuthenticated, tenant } = useAuth();
  return useQuery({
    queryKey: [...KEY(tenant?.id), sessionId, "contacts", list],
    queryFn: () => sessionSettingsService.listContacts(sessionId as string, list),
    enabled: isAuthenticated && Boolean(tenant) && Boolean(sessionId),
    staleTime: 15_000,
  });
}

export function useAddContactToList(sessionId: string) {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: (payload: AddContactToListPayload) =>
      sessionSettingsService.addContact(sessionId, payload),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: [...KEY(tenant?.id), sessionId, "contacts", vars.list],
      });
      toast.success("Contato adicionado à lista.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível adicionar o contato."));
    },
  });
}

export function useRemoveContactFromList(sessionId: string) {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: (args: { itemId: string; list: ContactList }) =>
      sessionSettingsService.removeContact(sessionId, args.itemId),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({
        queryKey: [...KEY(tenant?.id), sessionId, "contacts", vars.list],
      });
      toast.success("Contato removido da lista.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível remover o contato."));
    },
  });
}

export function useUpsertContact() {
  return useMutation({
    mutationFn: sessionSettingsService.upsertContact,
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível criar o contato."));
    },
  });
}

/**
 * 🔒 S24 — Hook que dispara o gate `POST /:id/connect` (enfileira o QR).
 * Equivalente ao antigo fluxo de "criar e já conectar" mas com validação
 * de bot/lista antes.
 */
export function useConnectSession() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: (sessionId: string) => sessionConnectService.connect(sessionId),
    onSuccess: (_data, sessionId) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp"] });
      // FIX 6 — Invalida o cache do QR ao iniciar conexão para que o
      // useSessionQr comece o polling do zero (sem servir cache stale).
      queryClient.invalidateQueries({ queryKey: ["whatsapp", tenant?.id, "session-qr", sessionId] });
      toast.success("Conectando — QR Code disponível.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível gerar o QR Code."));
    },
  });
}
