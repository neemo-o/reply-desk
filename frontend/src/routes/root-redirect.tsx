import { Navigate } from "react-router-dom";
import { LandingPage } from "@/pages/landing/landing-page";
import { useAuth } from "@/contexts/auth-provider";
import { FullscreenLoader } from "@/components/layout/fullscreen-loader";

/**
 * Rota raiz ("/"): se o usuário está autenticado e com e-mail verificado,
 * redireciona para o dashboard. Caso contrário, mostra a landing page.
 *
 * Não verificamos a assinatura aqui — o SubscriptionGate em /dashboard
 * cuida disso. Usuários autenticados sem assinatura ativa serão redirecionados
 * para /choose-plan pelo gate.
 */
export function RootRedirect() {
  const { isAuthenticated, isInitializing, user } = useAuth();

  if (isInitializing) {
    return <FullscreenLoader />;
  }

  if (isAuthenticated && user?.emailVerified) {
    return <Navigate to="/dashboard" replace />;
  }

  return <LandingPage />;
}
