import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  tenantsService,
  type UpdateTenantPayload,
  type UpdateMemberRolePayload,
  type InviteMemberPayload,
} from "@/services/tenants-service";
import { useAuth } from "@/contexts/auth-provider";
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/lib/api-errors";

export function useTenantSummary() {
  const { isAuthenticated, tenant } = useAuth();

  return useQuery({
    queryKey: ["tenants", "mine", tenant?.id],
    queryFn: async () => {
      const tenants = await tenantsService.findMine();
      return tenants.find((t) => t.id === tenant?.id) ?? tenants[0] ?? null;
    },
    enabled: isAuthenticated && Boolean(tenant),
  });
}

export function useTenantMembers() {
  const { isAuthenticated, tenant } = useAuth();

  return useQuery({
    queryKey: ["tenants", "members", tenant?.id],
    queryFn: () => tenantsService.listMembers(),
    enabled: isAuthenticated && Boolean(tenant),
  });
}

export function useUpdateTenant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateTenantPayload) => tenantsService.updateTenant(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      toast.success("Organização atualizada com sucesso");
    },
    onError: (error) => {
      toast.error(extractApiErrorMessage(error, "Não foi possível atualizar a organização"));
    },
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (memberId: string) => tenantsService.removeMember(memberId),
    onSuccess: (_data, _memberId) => {
      queryClient.invalidateQueries({ queryKey: ["tenants", "members"] });
    },
    onError: (error) => {
      toast.error(extractApiErrorMessage(error, "Não foi possível remover o membro"));
    },
  });
}

export function useInviteMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: InviteMemberPayload) => tenantsService.inviteMember(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants", "members"] });
      toast.success("Membro convidado com sucesso");
    },
    onError: (error) => {
      toast.error(extractApiErrorMessage(error, "Não foi possível convidar o membro"));
    },
  });
}

export function useUpdateMemberRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ memberId, roleName }: { memberId: string; roleName: UpdateMemberRolePayload["roleName"] }) =>
      tenantsService.updateMemberRole(memberId, { roleName }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants", "members"] });
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
    },
    onError: (error) => {
      toast.error(extractApiErrorMessage(error, "Não foi possível alterar a role do membro"));
    },
  });
}
