import { DashboardLayout } from "@/layouts/dashboard-layout";
import { AccountCard } from "@/components/dashboard/profile/account-card";
import { OrganizationCard } from "@/components/dashboard/profile/organization-card";
import { BillingCard } from "@/components/dashboard/profile/billing-card";
import { useAuth } from "@/contexts/auth-provider";

export function ProfilePage() {
  const { role } = useAuth();

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Perfil</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gerencie sua conta, sua organização e a assinatura do ReplyDesk.
        </p>
      </div>

      <div className="space-y-6">
        <AccountCard />
        <OrganizationCard />
        {role === "owner" && <BillingCard />}
      </div>
    </DashboardLayout>
  );
}
