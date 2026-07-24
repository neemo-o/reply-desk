import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSubscription } from "@/hooks/use-subscription";
import { usePlans } from "@/hooks/use-plans";
import { subscriptionsService } from "@/services/subscriptions-service";
import type { UpgradePreview } from "@/types/billing";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { getPlanFeatures } from "@/lib/plan-features";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  active: { label: "Ativa", variant: "success" },
  trialing: { label: "Em teste grátis", variant: "success" },
  past_due: { label: "Pagamento pendente", variant: "warning" },
  pending: { label: "Aguardando pagamento", variant: "warning" },
  cancelled: { label: "Cancelada", variant: "destructive" },
};

function formatPrice(price: string | number) {
  return Number(price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value?: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("pt-BR");
}

type PendingAction =
  | { kind: "upgrade"; planId: string; planName: string }
  | { kind: "downgrade"; planId: string; planName: string }
  | { kind: "cancel" }
  | { kind: "reactivate" };

export function BillingCard() {
  const queryClient = useQueryClient();
  const { data: subscription, isLoading: isLoadingSubscription } = useSubscription();
  const { data: plans, isLoading: isLoadingPlans } = usePlans();
  const [actionPlanId, setActionPlanId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [preview, setPreview] = useState<UpgradePreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  async function invalidateSubscription() {
    await queryClient.invalidateQueries({ queryKey: ["subscriptions", "me"] });
  }

  async function confirmUpgradeOrDowngrade(planId: string, kind: "upgrade" | "downgrade") {
    setActionPlanId(planId);
    setPending(null);
    try {
      await subscriptionsService.upgradePlan(planId);
      await invalidateSubscription();
      toast.success(
        kind === "upgrade" ? "Plano atualizado com sucesso" : "Plano reduzido com sucesso",
      );
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Não foi possível alterar o plano agora"));
    } finally {
      setActionPlanId(null);
    }
  }

  async function confirmCancel() {
    setIsCancelling(true);
    setPending(null);
    try {
      await subscriptionsService.cancel();
      await invalidateSubscription();
      toast.success("Cancelamento agendado — você mantém acesso até o fim do ciclo");
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Não foi possível cancelar a assinatura"));
    } finally {
      setIsCancelling(false);
    }
  }

  async function confirmReactivate() {
    setIsCancelling(true);
    setPending(null);
    try {
      await subscriptionsService.reactivate();
      await invalidateSubscription();
      toast.success("Assinatura reativada com sucesso");
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Não foi possível reativar a assinatura"));
    } finally {
      setIsCancelling(false);
    }
  }

  // 🔒 Quando o usuário clica em upgrade/downgrade, busca o preview da prorratação
  // no Stripe antes de abrir o dialog de confirmação.
  async function requestUpgradePreview(planId: string, kind: "upgrade" | "downgrade", planName: string) {
    setPending({ kind, planId, planName });
    setPreview(null);
    setIsLoadingPreview(true);
    try {
      const result = await subscriptionsService.previewUpgrade(planId);
      setPreview(result);
    } catch (error) {
      // Se o preview falhar (ex: assinatura em trial sem cartão), abre o dialog
      // sem mostrar o valor — a confirmação ainda funciona.
      toast.error(extractApiErrorMessage(error, "Não foi possível calcular a prorratação"));
      setPending(null);
    } finally {
      setIsLoadingPreview(false);
    }
  }

  function closeDialog() {
    if (isRunning) return;
    setPending(null);
    setPreview(null);
  }

  const status = subscription ? STATUS_LABELS[subscription.status] : null;
  const canCancel = subscription && ["active", "trialing", "past_due"].includes(subscription.status);
  const isScheduledCancel = Boolean(subscription?.cancelAtPeriodEnd);

  // Texto contextual do AlertDialog (upgrade / downgrade / cancel / reactivate)
  const dialogConfig = (() => {
    if (!pending) return null;
    if (pending.kind === "cancel") {
      return {
        title: "Cancelar assinatura",
        description:
          "Tem certeza que deseja cancelar? Sua assinatura permanecerá ativa até o fim do ciclo de cobrança atual. Após essa data, o acesso à plataforma será bloqueado. Você pode reativar a qualquer momento antes do fim do ciclo.",
        actionLabel: "Agendar cancelamento",
        actionVariant: "destructive" as const,
      };
    }
    if (pending.kind === "reactivate") {
      return {
        title: "Reativar assinatura",
        description:
          "Tem certeza que deseja reativar? O cancelamento agendado será removido e sua assinatura continuará sendo cobrada mensalmente de forma automática.",
        actionLabel: "Reativar assinatura",
        actionVariant: "default" as const,
      };
    }
    if (pending.kind === "upgrade") {
      const prorationText = preview
        ? preview.amountDue > 0
          ? `Será adicionado ${formatPrice(preview.amountDue)} à sua próxima fatura (diferença proporcional dos dias restantes). `
          : "Nenhuma cobrança adicional. "
        : "";
      return {
        title: `Fazer upgrade para ${pending.planName}`,
        description:
          `${prorationText}O novo plano entra em vigor imediatamente e o valor integral será cobrado no próximo ciclo de cobrança.`,
        actionLabel: "Confirmar upgrade",
        actionVariant: "default" as const,
      };
    }
    const prorationText = preview
      ? preview.amountDue > 0
        ? `Será adicionado ${formatPrice(preview.amountDue)} à sua próxima fatura (diferença proporcional dos dias restantes). `
        : preview.amountDue === 0
          ? "Nenhuma cobrança adicional — o novo valor entra em vigor no próximo ciclo. "
          : `Você receberá um crédito de ${formatPrice(Math.abs(preview.amountDue))} na próxima fatura. `
      : "";
    return {
      title: `Fazer downgrade para ${pending.planName}`,
      description:
        `${prorationText}Você pode perder acesso a recursos ativos (sessões, usuários, bots) que excedam os limites do novo plano.`,
      actionLabel: "Confirmar downgrade",
      actionVariant: "default" as const,
    };
  })();

  const isRunning = actionPlanId !== null || isCancelling;
  const isDialogLoading = isLoadingPreview || isRunning;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plano e cobrança</CardTitle>
        <CardDescription>Gerencie a assinatura da sua organização.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoadingSubscription ? (
          <Skeleton className="h-20 w-full" />
        ) : subscription ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
            <div>
              <p className="font-medium">{subscription.plan.name}</p>
              <p className="text-sm text-muted-foreground">
                {subscription.billingType === "recurring" ? "Cobrança mensal recorrente" : "Pagamento único"}
                {subscription.cancelAtPeriodEnd && formatDate(subscription.expiresAt)
                  ? ` · cancelamento agendado para ${formatDate(subscription.expiresAt)}`
                  : subscription.status === "trialing" && formatDate(subscription.trialUntil)
                    ? ` · teste até ${formatDate(subscription.trialUntil)}`
                    : subscription.expiresAt
                      ? ` · válido até ${formatDate(subscription.expiresAt)}`
                      : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {status && <Badge variant={status.variant}>{status.label}</Badge>}
              {subscription.cancelAtPeriodEnd && (
                <Badge variant="warning">Cancelamento agendado</Badge>
              )}
              {canCancel && !subscription.cancelAtPeriodEnd && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isRunning}
                  onClick={() => setPending({ kind: "cancel" })}
                >
                  {isCancelling && <Loader2 className="animate-spin" />}
                  Cancelar assinatura
                </Button>
              )}
              {subscription.cancelAtPeriodEnd && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isRunning}
                  onClick={() => setPending({ kind: "reactivate" })}
                >
                  {isCancelling && <Loader2 className="animate-spin" />}
                  Reativar assinatura
                </Button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma assinatura encontrada para esta organização.</p>
        )}

        {isScheduledCancel ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <p className="font-medium text-amber-600 dark:text-amber-400">
              Cancelamento agendado
            </p>
            <p className="mt-1 text-muted-foreground">
              Sua assinatura será cancelada em {formatDate(subscription?.expiresAt)}. Para trocar de plano,
              reative a assinatura primeiro.
            </p>
          </div>
        ) : (
          <div>
            <p className="mb-3 text-sm font-medium">Planos disponíveis</p>
            {isLoadingPlans ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-56 w-full" />
                <Skeleton className="h-56 w-full" />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {plans?.map((plan) => {
                  const isCurrent = subscription?.planId === plan.id && subscription.isActive;
                  const currentPrice = Number(subscription?.plan.price ?? 0);
                  const planPrice = Number(plan.price);
                  const action: "upgrade" | "downgrade" | "current" = isCurrent
                    ? "current"
                    : planPrice > currentPrice
                      ? "upgrade"
                      : "downgrade";
                  const features = getPlanFeatures(plan.name);
                  return (
                    <div
                      key={plan.id}
                      className={cn(
                        "relative flex flex-col rounded-lg border p-4",
                        isCurrent
                          ? "border-brand-500 ring-1 ring-brand-500"
                          : plan.name.trim().toLowerCase() === "premium"
                            ? "border-brand-500/60"
                            : "border-border",
                      )}
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <p className="font-display font-semibold">{plan.name}</p>
                        {isCurrent && <Badge variant="success">Plano atual</Badge>}
                      </div>
                      <p className="mb-3 text-2xl font-semibold tracking-tight">
                        {formatPrice(plan.price)}
                        <span className="text-sm font-normal text-muted-foreground">/mês</span>
                      </p>
                      <div className="mb-4 flex-1 space-y-1.5 text-sm">
                        {features
                          ? features.map((feature) => (
                            <div
                              key={feature.label}
                              className={cn(
                                "flex items-center gap-2",
                                feature.included ? "text-foreground" : "text-muted-foreground",
                              )}
                            >
                              {feature.included ? (
                                <Check className="h-3.5 w-3.5 shrink-0 text-brand-500" />
                              ) : (
                                <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                              )}
                              <span className={feature.included ? "" : "line-through opacity-70"}>
                                {feature.label}
                              </span>
                            </div>
                          ))
                          : (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Check className="h-3.5 w-3.5 shrink-0 text-brand-500" />
                              {plan.maxSessions} sessões · {plan.maxUsers} usuários · {plan.maxBots} bots
                            </div>
                          )}
                      </div>
                      <Button
                        variant={isCurrent ? "secondary" : "outline"}
                        size="sm"
                        disabled={isCurrent || isRunning || !subscription}
                        onClick={() =>
                          requestUpgradePreview(plan.id, action === "current" ? "upgrade" : action, plan.name)
                        }
                      >
                        {actionPlanId === plan.id && <Loader2 className="animate-spin" />}
                        {isCurrent
                          ? "Plano atual"
                          : action === "upgrade"
                            ? "Fazer upgrade"
                            : "Fazer downgrade"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogConfig?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {isLoadingPreview
                ? "Calculando prorratação com o Stripe..."
                : dialogConfig?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDialogLoading}>Voltar</AlertDialogCancel>
            <AlertDialogAction
              variant={dialogConfig?.actionVariant}
              disabled={isDialogLoading}
              onClick={(e) => {
                e.preventDefault();
                if (!pending) return;
                if (pending.kind === "cancel") {
                  void confirmCancel();
                } else if (pending.kind === "reactivate") {
                  void confirmReactivate();
                } else {
                  void confirmUpgradeOrDowngrade(pending.planId, pending.kind);
                }
              }}
            >
              {isRunning && <Loader2 className="animate-spin" />}
              {dialogConfig?.actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
