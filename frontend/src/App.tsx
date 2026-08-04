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
import { MembersPage } from "@/pages/dashboard/members-page";
import { WhatsappPage } from "@/pages/dashboard/whatsapp-page";
import { BotsPage } from "@/pages/dashboard/bots-page";
import { BotEditorPage } from "@/pages/dashboard/bot-editor-page";
import { BroadcastEditorPage } from "@/pages/dashboard/broadcast-editor-page";
import { ContactListsPage } from "@/pages/dashboard/contact-lists-page";
import { ContactListDetailPage } from "@/pages/dashboard/contact-list-detail-page";
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
          <Route path="/dashboard/whatsapp" element={<WhatsappPage />} />
          <Route path="/dashboard/bots" element={<BotsPage />} />
          <Route path="/dashboard/bots/:id" element={<BotEditorPage />} />
          <Route path="/dashboard/broadcasts/:id" element={<BroadcastEditorPage />} />
          <Route path="/dashboard/contact-lists" element={<ContactListsPage />} />
          <Route path="/dashboard/contact-lists/:id" element={<ContactListDetailPage />} />
          <Route path="/dashboard/profile" element={<ProfilePage />} />
          <Route path="/dashboard/members" element={<MembersPage />} />
        </Route>
      </Route>

      <Route path="/404" element={<NotFoundPage />} />
      <Route path="*" element={<Navigate to="/404" replace />} />
    </Routes>
  );
}
