import { User, Building2, CreditCard, Settings } from "lucide-react";
import { DashboardLayout } from "@/layouts/dashboard-layout";
import { AccountCard } from "@/components/dashboard/profile/account-card";
import { OrganizationCard } from "@/components/dashboard/profile/organization-card";
import { BillingCard } from "@/components/dashboard/profile/billing-card";
import { PaymentDetailsCard } from "@/components/dashboard/profile/payment-details-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/auth-provider";

export function ProfilePage() {
  const { role } = useAuth();
  const isOwner = role === "owner";

  return (
    <DashboardLayout>
      <div className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Settings className="h-6 w-6" />
          Configurações
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gerencie sua conta, sua organização e a assinatura do ReplyDesk.
        </p>
      </div>

      <Tabs defaultValue="account" className="w-full">
        <TabsList className="mb-2 flex w-fit flex-wrap h-auto">
          <TabsTrigger value="account" className="gap-2">
            <User className="h-4 w-4" />
            Conta
          </TabsTrigger>
          <TabsTrigger value="organization" className="gap-2">
            <Building2 className="h-4 w-4" />
            Organização
          </TabsTrigger>
          {isOwner && (
            <TabsTrigger value="billing" className="gap-2">
              <CreditCard className="h-4 w-4" />
              Faturamento
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="account">
          <AccountCard />
        </TabsContent>

        <TabsContent value="organization">
          <OrganizationCard />
        </TabsContent>

        {isOwner && (
          <TabsContent value="billing" className="space-y-6">
            <BillingCard />
            <PaymentDetailsCard />
          </TabsContent>
        )}
      </Tabs>
    </DashboardLayout>
  );
}
