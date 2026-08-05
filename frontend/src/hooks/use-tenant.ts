import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  tenantsService,
  type UpdateTenantPayload,
  type UpdateTenantSettingsPayload,
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

export function useTenantSettings() {
  const { isAuthenticated, tenant } = useAuth();
  const canManage = tenant?.role === "owner" || tenant?.role === "admin";

  return useQuery({
    queryKey: ["tenants", "settings", tenant?.id],
    queryFn: () => tenantsService.getSettings(),
    enabled: isAuthenticated && Boolean(tenant) && canManage,
  });
}

export function useUpdateTenantSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: UpdateTenantSettingsPayload) =>
      tenantsService.updateSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      toast.success("Configurações da organização salvas");
    },
    onError: (error) => {
      toast.error(
        extractApiErrorMessage(error, "Não foi possível salvar as configurações da organização"),
      );
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
      queryClient.invalidateQueries({ queryKey: ["tenants", "invitations"] });
      toast.success("Convite enviado com sucesso");
    },
    onError: (error) => {
      toast.error(extractApiErrorMessage(error, "Não foi possível convidar o membro"));
    },
  });
}

export function useTenantInvitations() {
  const { isAuthenticated, tenant, role } = useAuth();
  const canManage = role === "owner" || role === "admin";

  return useQuery({
    queryKey: ["tenants", "invitations", tenant?.id],
    queryFn: () => tenantsService.listInvitations(),
    enabled: isAuthenticated && Boolean(tenant) && canManage,
  });
}

export function useCancelInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (invitationId: string) => tenantsService.cancelInvitation(invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tenants", "invitations"] });
      toast.success("Convite cancelado");
    },
    onError: (error) => {
      toast.error(extractApiErrorMessage(error, "Não foi possível cancelar o convite"));
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

export function useTransferOwnership() {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();

  return useMutation({
    mutationFn: (newOwnerTenantUserId: string) =>
      tenantsService.transferOwnership(newOwnerTenantUserId),
    onSuccess: () => {
      // Invalida lista de membros e snapshot do usuário — o antigo dono
      // agora é admin e precisa ver a UI mudar imediatatamente.
      queryClient.invalidateQueries({ queryKey: ["tenants", "members"] });
      queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      void refreshUser();
      toast.success("Ownership transferido com sucesso. Você agora é administrador.");
    },
    onError: (error) => {
      toast.error(extractApiErrorMessage(error, "Não foi possível transferir o ownership"));
    },
  });
}
