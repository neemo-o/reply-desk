import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Loader2, X, ArrowLeft, Sparkles, TrendingUp, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import { OnboardingLayout } from "@/layouts/onboarding-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import { usePlans } from "@/hooks/use-plans";
import { useSubscription } from "@/hooks/use-subscription";
import { subscriptionsService } from "@/services/subscriptions-service";
import { useAuth } from "@/contexts/auth-provider";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { getPlanFeatures } from "@/lib/plan-features";
import { cn } from "@/lib/utils";
import type { BillingType, Subscription, UpgradePreview } from "@/types/billing";

function formatPrice(price: string | number) {
  return Number(price).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type PlanAction = "current" | "upgrade" | "downgrade" | "subscribe";

type PendingAction =
  | { kind: "upgrade"; planId: string; planName: string }
  | { kind: "downgrade"; planId: string; planName: string }
  | { kind: "subscribe"; planId: string; planName: string; billingType: BillingType };

export function ChoosePlanPage() {
  const { data: plans, isLoading: isLoadingPlans } = usePlans();
  const { data: subscription, isLoading: isLoadingSubscription } = useSubscription();
  const { isAuthenticated } = useAuth();

  // 🔒 Determina o contexto do usuário:
  // - hasActiveSubscription: usuário já tem assinatura ativa/trialing → mode = "manage"
  // - isExistingUser: logado mas sem assinatura ativa → mode = "resubscribe"
  // - newUser (onboarding): não logado ou novo → mode = "onboarding"
  const hasActiveSubscription =
    !!subscription && (subscription.isActive || subscription.status === "trialing");
  const mode: "manage" | "resubscribe" | "onboarding" =
    hasActiveSubscription ? "manage" : isAuthenticated ? "resubscribe" : "onboarding";

  const [billingType, setBillingType] = useState<BillingType>("recurring");
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [preview, setPreview] = useState<UpgradePreview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  async function handleSubscribe(planId: string, bt: BillingType) {
    setLoadingPlanId(planId);
    try {
      const { checkoutUrl } = await subscriptionsService.createCheckout(planId, bt);
      window.location.href = checkoutUrl;
    } catch (error) {
      const message = extractApiErrorMessage(error, "Não foi possível iniciar o pagamento agora");
      toast.error(message);
      setLoadingPlanId(null);
    }
  }

  async function requestUpgradePreview(
    planId: string,
    kind: "upgrade" | "downgrade",
    planName: string,
  ) {
    setPending({ kind, planId, planName });
    setPreview(null);
    setIsLoadingPreview(true);
    try {
      const result = await subscriptionsService.previewUpgrade(planId);
      setPreview(result);
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Não foi possível calcular a prorratação"));
      setPending(null);
    } finally {
      setIsLoadingPreview(false);
    }
  }

  async function confirmUpgradeOrDowngrade(planId: string, kind: "upgrade" | "downgrade") {
    setLoadingPlanId(planId);
    setPending(null);
    try {
      await subscriptionsService.upgradePlan(planId);
      toast.success(
        kind === "upgrade" ? "Plano atualizado com sucesso" : "Plano reduzido com sucesso",
      );
      // Recarrega a página para refletir a nova assinatura
      window.location.reload();
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Não foi possível alterar o plano agora"));
      setLoadingPlanId(null);
    }
  }

  function getPlanAction(planPrice: number, sub: Subscription | null | undefined): PlanAction {
    if (!sub || !sub.isActive) return "subscribe";
    const currentPrice = Number(sub.plan.price);
    if (sub.planId === plans?.find((p) => Number(p.price) === planPrice)?.id) return "current";
    return planPrice > currentPrice ? "upgrade" : "downgrade";
  }

  // Texto do dialog de confirmação para upgrade/downgrade
  const dialogConfig = (() => {
    if (!pending) return null;
    if (pending.kind === "subscribe") {
      return {
        title: `Assinar ${pending.planName}`,
        description:
          pending.billingType === "recurring"
            ? "Você será redirecionado para o Stripe para concluir o pagamento. A cobrança será mensal e automática."
            : "Você será redirecionado para o Stripe para concluir o pagamento único de 1 mês de acesso.",
        actionLabel: "Ir para pagamento",
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
      title:
        pending.kind === "upgrade" ? `Fazer upgrade para ${pending.planName}` : `Fazer downgrade para ${pending.planName}`,
      description:
        pending.kind === "upgrade"
          ? `${prorationText}O novo plano entra em vigor imediatamente e o valor integral será cobrado no próximo ciclo de cobrança.`
          : `${prorationText}Você pode perder acesso a recursos ativos (sessões, usuários, bots) que excedam os limites do novo plano.`,
      actionLabel: pending.kind === "upgrade" ? "Confirmar upgrade" : "Confirmar downgrade",
    };
  })();

  const isRunning = loadingPlanId !== null;
  const isDialogLoading = isLoadingPreview || isRunning;

  return (
    <OnboardingLayout
      title={mode === "manage" ? "Gerenciar plano" : "Escolha seu plano"}
      subtitle={
        mode === "manage"
          ? "Faça upgrade ou downgrade do seu plano a qualquer momento"
          : mode === "resubscribe"
            ? "Escolha um plano para reativar sua assinatura e voltar a usar o ReplyDesk"
            : "Selecione o plano ideal para o seu time começar a atender no ReplyDesk"
      }
    >
      {mode === "manage" && subscription && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
          <div>
            <p className="font-medium">{subscription.plan.name}</p>
            <p className="text-sm text-muted-foreground">
              {subscription.billingType === "recurring" ? "Cobrança mensal recorrente" : "Pagamento único"}
              {subscription.cancelAtPeriodEnd && subscription.expiresAt
                ? ` · cancelamento agendado para ${new Date(subscription.expiresAt).toLocaleDateString("pt-BR")}`
                : subscription.status === "trialing" && subscription.trialUntil
                  ? ` · teste até ${new Date(subscription.trialUntil).toLocaleDateString("pt-BR")}`
                  : subscription.expiresAt
                    ? ` · válido até ${new Date(subscription.expiresAt).toLocaleDateString("pt-BR")}`
                    : ""}
            </p>
          </div>
          <Badge variant={subscription.status === "trialing" ? "success" : "success"}>
            {subscription.status === "trialing" ? "Em teste grátis" : "Ativa"}
          </Badge>
        </div>
      )}

      {mode === "resubscribe" && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <p className="font-medium text-amber-600 dark:text-amber-400">
            Assinatura inativa
          </p>
          <p className="mt-1 text-muted-foreground">
            Sua assinatura anterior não está mais ativa. Escolha um plano abaixo para voltar a usar o ReplyDesk.
          </p>
        </div>
      )}

      {/* 🔒 Toggle de tipo de cobrança — só para "resubscribe" e "onboarding".
          No modo "manage" o upgrade/downgrade é sempre recorrente. */}
      {mode !== "manage" && (
        <div className="mb-8 flex justify-center">
          <div className="inline-flex rounded-lg bg-secondary p-1">
            <button
              type="button"
              onClick={() => setBillingType("recurring")}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                billingType === "recurring" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              Mensal recorrente
            </button>
            <button
              type="button"
              onClick={() => setBillingType("one_time")}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                billingType === "one_time" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              Pagamento único (1 mês)
            </button>
          </div>
        </div>
      )}

      {isLoadingPlans || (mode === "manage" && isLoadingSubscription) ? (
        <div className="grid gap-6 sm:grid-cols-2">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {plans?.map((plan) => {
            const features = getPlanFeatures(plan.name);
            const isPremium = plan.name.trim().toLowerCase() === "premium";
            const isBasic = plan.name.trim().toLowerCase() === "basic";

            // Calcula a ação para o botão
            const action = getPlanAction(Number(plan.price), subscription);
            const isCurrent = action === "current";

            // Badge de trial grátis no Basic (só no modo onboarding/resubscribe)
            const showTrialBadge =
              (mode === "onboarding" || mode === "resubscribe") && isBasic && billingType === "recurring";

            return (
              <Card
                key={plan.id}
                className={cn(
                  "relative flex flex-col",
                  isCurrent && "border-brand-500 ring-1 ring-brand-500",
                  !isCurrent && isPremium && "border-brand-500/60",
                )}
              >
                {isPremium && !isCurrent && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-white shadow">
                    Mais popular
                  </span>
                )}
                {isCurrent && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-emerald-500 px-3 py-1 text-xs font-semibold text-white shadow">
                    Plano atual
                  </span>
                )}
                {showTrialBadge && (
                  <span className="absolute -top-3 right-4 flex items-center gap-1 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow">
                    <Sparkles className="h-3 w-3" />
                    7 dias grátis
                  </span>
                )}
                <CardHeader>
                  <CardTitle className="font-display text-xl">{plan.name}</CardTitle>
                  <p className="mt-1">
                    <span className="text-3xl font-semibold tracking-tight">{formatPrice(plan.price)}</span>
                    <span className="text-sm text-muted-foreground">
                      {mode === "manage"
                        ? "/mês"
                        : billingType === "recurring"
                          ? "/mês"
                          : " (1 mês de acesso)"}
                    </span>
                  </p>
                </CardHeader>
                <CardContent className="flex-1 space-y-2.5">
                  {features
                    ? features.map((feature) => (
                        <div
                          key={feature.label}
                          className={cn(
                            "flex items-center gap-2 text-sm",
                            feature.included ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {feature.included ? (
                            <Check className="h-4 w-4 shrink-0 text-brand-500" />
                          ) : (
                            <X className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className={feature.included ? "" : "line-through opacity-70"}>
                            {feature.label}
                          </span>
                        </div>
                      ))
                    : [
                        `${plan.maxSessions} sessões de WhatsApp`,
                        `${plan.maxUsers} usuários no time`,
                        `${plan.maxBots} bots automatizados`,
                        `${plan.maxMessages.toLocaleString("pt-BR")} mensagens/mês`,
                        `${plan.maxStorageMb} MB de armazenamento`,
                        `${plan.maxAiRequests} requisições de IA/mês`,
                      ].map((feature) => (
                        <div key={feature} className="flex items-center gap-2 text-sm">
                          <Check className="h-4 w-4 shrink-0 text-brand-500" />
                          {feature}
                        </div>
                      ))}
                </CardContent>
                <CardFooter>
                  {isCurrent ? (
                    <Button variant="secondary" className="w-full" disabled>
                      Plano atual
                    </Button>
                  ) : action === "upgrade" ? (
                    <Button
                      variant="glow"
                      className="w-full"
                      disabled={isRunning}
                      onClick={() => requestUpgradePreview(plan.id, "upgrade", plan.name)}
                    >
                      {loadingPlanId === plan.id && <Loader2 className="animate-spin" />}
                      <TrendingUp className="h-4 w-4" />
                      Fazer upgrade
                    </Button>
                  ) : action === "downgrade" ? (
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={isRunning}
                      onClick={() => requestUpgradePreview(plan.id, "downgrade", plan.name)}
                    >
                      {loadingPlanId === plan.id && <Loader2 className="animate-spin" />}
                      <TrendingDown className="h-4 w-4" />
                      Fazer downgrade
                    </Button>
                  ) : (
                    <Button
                      variant="glow"
                      className="w-full"
                      disabled={isRunning}
                      onClick={() =>
                        setPending({ kind: "subscribe", planId: plan.id, planName: plan.name, billingType })
                      }
                    >
                      {loadingPlanId === plan.id && <Loader2 className="animate-spin" />}
                      Assinar {plan.name}
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {mode === "manage" && (
        <div className="mt-8 text-center">
          <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Button>
        </div>
      )}

      {/* Dialog de confirmação — upgrade, downgrade e assinar */}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !isDialogLoading) {
            setPending(null);
            setPreview(null);
          }
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
              disabled={isDialogLoading}
              onClick={(e) => {
                e.preventDefault();
                if (!pending) return;
                if (pending.kind === "subscribe") {
                  void handleSubscribe(pending.planId, pending.billingType);
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
    </OnboardingLayout>
  );
}
