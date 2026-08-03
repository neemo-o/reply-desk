import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { contactListsService } from "@/services/contact-lists-service";
import { useAuth } from "@/contexts/auth-provider";
import { extractApiErrorMessage } from "@/lib/api-errors";
import type { AddContactsPayload, CreateContactListPayload } from "@/types/contact-lists";

export function useContactLists() {
  const { isAuthenticated, tenant } = useAuth();
  return useQuery({
    queryKey: ["contact-lists", tenant?.id],
    queryFn: contactListsService.list,
    enabled: isAuthenticated && Boolean(tenant),
    staleTime: 30_000,
  });
}

export function useContactList(id: string) {
  const { isAuthenticated, tenant } = useAuth();
  return useQuery({
    queryKey: ["contact-lists", tenant?.id, id],
    queryFn: () => contactListsService.getOne(id),
    enabled: isAuthenticated && Boolean(tenant) && Boolean(id),
  });
}

export function useCreateContactList() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: (payload: CreateContactListPayload) => contactListsService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact-lists", tenant?.id] });
      toast.success("Lista de contatos criada.");
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível criar a lista."));
    },
  });
}

export function useDeleteContactList() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: (id: string) => contactListsService.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact-lists", tenant?.id] });
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível remover a lista."));
    },
  });
}

export function useAddContactsToList() {
  const queryClient = useQueryClient();
  const { tenant } = useAuth();
  return useMutation({
    mutationFn: ({ listId, payload }: { listId: string; payload: AddContactsPayload }) =>
      contactListsService.addContacts(listId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contact-lists", tenant?.id] });
    },
    onError: (err) => {
      toast.error(extractApiErrorMessage(err, "Não foi possível adicionar contatos."));
    },
  });
}