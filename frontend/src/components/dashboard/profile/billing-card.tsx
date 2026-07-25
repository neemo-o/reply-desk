import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { subscriptionsService } from "@/services/subscriptions-service";
import { extractApiErrorMessage } from "@/lib/api-errors";

const STATUS_LABELS: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "secondary" }> = {
  active: { label: "Ativa", variant: "success" },
  trialing: { label: "Em teste grátis", variant: "success" },
  past_due: { label: "Pagamento pendente", variant: "warning" },
  pending: { label: "Aguardando pagamento", variant: "warning" },
  cancelled: { label: "Cancelada", variant: "destructive" },
};

function formatDate(value?: string | null) {
  if (!value) return null;
  return new Date(value).toLocaleDateString("pt-BR");
}

type PendingAction =
  | { kind: "cancel" }
  | { kind: "reactivate" };

export function BillingCard() {
  const queryClient = useQueryClient();
  const { data: subscription, isLoading: isLoadingSubscription } = useSubscription();
  const [isCancelling, setIsCancelling] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);

  async function invalidateSubscription() {
    await queryClient.invalidateQueries({ queryKey: ["subscriptions", "me"] });
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

  function closeDialog() {
    if (isRunning) return;
    setPending(null);
  }

  const status = subscription ? STATUS_LABELS[subscription.status] : null;
  const canCancel = subscription && ["active", "trialing", "past_due"].includes(subscription.status);
  const isScheduledCancel = Boolean(subscription?.cancelAtPeriodEnd);

  // Texto contextual do AlertDialog (cancel / reactivate)
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
    return {
      title: "Reativar assinatura",
      description:
        "Tem certeza que deseja reativar? O cancelamento agendado será removido e sua assinatura continuará sendo cobrada mensalmente de forma automática.",
      actionLabel: "Reativar assinatura",
      actionVariant: "default" as const,
    };
  })();

  const isRunning = isCancelling;
  const isDialogLoading = isRunning;

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
          <a href="/choose-plan">
            <Button variant="outline" size="sm" disabled={isRunning} className="w-full">
              Gerenciar plano (upgrade/downgrade)
            </Button>
          </a>
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
            {dialogConfig?.description}
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
                } else {
                  void confirmReactivate();
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
