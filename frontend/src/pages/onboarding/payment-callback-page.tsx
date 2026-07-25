import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { OnboardingLayout } from "@/layouts/onboarding-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { subscriptionsService } from "@/services/subscriptions-service";
import { useAuth } from "@/contexts/auth-provider";

const POLL_INTERVAL_MS = 3000;
const MAX_ATTEMPTS = 20; // ~1 minuto

export function PaymentCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const checkoutResult = searchParams.get("checkout"); // "success" | "cancelled" | null
  const setupResult = searchParams.get("setup"); // "success" | "cancelled" | null (M18 — atualização de cartão)
  const [attempts, setAttempts] = useState(0);

  const wasCancelled = checkoutResult === "cancelled" || setupResult === "cancelled";

  // 🔒 M18 — Se é retorno de setup (atualização de cartão), não precisa de
  // polling de subscriptions — apenas invalida billing-details e redireciona.
  const isSetupFlow = setupResult === "success";

  useEffect(() => {
    if (isSetupFlow) {
      void queryClient
        .invalidateQueries({ queryKey: ["subscriptions", "billing-details"] })
        .then(() => navigate("/dashboard/profile", { replace: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSetupFlow]);

  const { data: subscription } = useQuery({
    queryKey: ["subscriptions", "me", "polling"],
    queryFn: () => subscriptionsService.getCurrent(),
    enabled: !wasCancelled && !isSetupFlow,
    refetchInterval: (query) => (query.state.data?.isActive ? false : POLL_INTERVAL_MS),
  });

  useEffect(() => {
    if (wasCancelled) return;
    if (subscription?.isActive) {
      void refreshUser().then(() => navigate("/dashboard", { replace: true }));
      return;
    }
    if (subscription) {
      setAttempts((prev) => prev + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscription]);

  if (wasCancelled) {
    return (
      <OnboardingLayout title="Pagamento cancelado">
        <div className="mx-auto max-w-md">
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <XCircle className="h-10 w-10 text-destructive" />
              <p className="font-medium">Você cancelou o checkout antes de concluir o pagamento.</p>
              <p className="text-sm text-muted-foreground">
                Nenhuma cobrança foi feita. Você pode escolher um plano novamente quando quiser.
              </p>
              <Button className="mt-2 w-full" onClick={() => navigate("/choose-plan")}>
                Escolher plano
              </Button>
            </CardContent>
          </Card>
        </div>
      </OnboardingLayout>
    );
  }

  const timedOut = attempts >= MAX_ATTEMPTS;

  return (
    <OnboardingLayout title="Confirmando seu pagamento">
      <div className="mx-auto max-w-md">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            {timedOut ? (
              <>
                <XCircle className="h-10 w-10 text-amber-500" />
                <p className="font-medium">Ainda estamos aguardando a confirmação do pagamento.</p>
                <p className="text-sm text-muted-foreground">
                  Isso pode levar mais alguns instantes. Você pode continuar aguardando ou verificar novamente.
                </p>
                <Button
                  className="mt-2 w-full"
                  onClick={() => setAttempts(0)}
                  variant="outline"
                >
                  Verificar novamente
                </Button>
              </>
            ) : (
              <>
                {subscription?.isActive ? (
                  <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                ) : (
                  <Loader2 className="h-10 w-10 animate-spin text-brand-500" />
                )}
                <p className="font-medium">Estamos confirmando seu pagamento com o Stripe...</p>
                <p className="text-sm text-muted-foreground">
                  Isso costuma levar só alguns segundos. Você será redirecionado automaticamente.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </OnboardingLayout>
  );
}
