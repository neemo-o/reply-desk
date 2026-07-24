import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/routes/protected-route";
import { PublicOnlyRoute } from "@/routes/public-only-route";
import { RootRedirect } from "@/routes/root-redirect";
import { SubscriptionGate } from "@/routes/subscription-gate";
import { LoginPage } from "@/pages/auth/login-page";
import { RegisterPage } from "@/pages/auth/register-page";
import { VerifyEmailPage } from "@/pages/auth/verify-email-page";
import { ChoosePlanPage } from "@/pages/onboarding/choose-plan-page";
import { PaymentCallbackPage } from "@/pages/onboarding/payment-callback-page";
import { DashboardPage } from "@/pages/dashboard/dashboard-page";
import { ProfilePage } from "@/pages/dashboard/profile-page";
import { NotFoundPage } from "@/pages/not-found-page";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/choose-plan" element={<ChoosePlanPage />} />
        <Route path="/payment/callback" element={<PaymentCallbackPage />} />

        <Route element={<SubscriptionGate />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/dashboard/profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
