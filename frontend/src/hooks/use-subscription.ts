import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { subscriptionsService } from "@/services/subscriptions-service";
import { useAuth } from "@/contexts/auth-provider";
import { toast } from "sonner";
import { extractApiErrorMessage } from "@/lib/api-errors";

export function useSubscription() {
  const { isAuthenticated, tenant } = useAuth();

  return useQuery({
    queryKey: ["subscriptions", "me", tenant?.id],
    queryFn: () => subscriptionsService.getCurrent(),
    enabled: isAuthenticated && Boolean(tenant),
  });
}

/**
 * 🔒 M18 — Detalhes de faturamento (cartão, próxima fatura, histórico).
 * Só habilitado se o usuário for owner/admin e tiver tenant.
 */
export function useBillingDetails() {
  const { isAuthenticated, tenant, role } = useAuth();
  const canManage = role === "owner" || role === "admin";

  return useQuery({
    queryKey: ["subscriptions", "billing-details", tenant?.id],
    queryFn: () => subscriptionsService.getBillingDetails(),
    enabled: isAuthenticated && Boolean(tenant) && canManage,
    retry: false,
  });
}

/**
 * 🔒 M18 — Cria sessão de checkout em modo "setup" para atualizar cartão.
 * Redireciona o usuário para a URL do Stripe.
 */
export function useUpdatePaymentMethod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => subscriptionsService.updatePaymentMethod(),
    onSuccess: (data) => {
      // Redireciona para o Stripe Checkout em modo setup
      window.location.href = data.checkoutUrl;
      // Invalida billing details para recarregar após retorno
      queryClient.invalidateQueries({ queryKey: ["subscriptions", "billing-details"] });
    },
    onError: (error) => {
      toast.error(extractApiErrorMessage(error, "Não foi possível iniciar a atualização do cartão"));
    },
  });
}
