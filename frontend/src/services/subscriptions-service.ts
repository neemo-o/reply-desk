import { apiClient } from "./api-client";
import type {
  BillingType,
  CheckoutResult,
  Plan,
  Subscription,
  UpgradePreview,
  BillingDetails,
  UpdatePaymentMethodResult,
} from "@/types/billing";

export const subscriptionsService = {
  async listPlans(): Promise<Plan[]> {
    const { data } = await apiClient.get<Plan[]>("/plans");
    return data;
  },

  async getCurrent(): Promise<Subscription | null> {
    const { data } = await apiClient.get<Subscription | null>("/subscriptions/me");
    return data;
  },

  async createCheckout(planId: string, billingType: BillingType = "recurring"): Promise<CheckoutResult> {
    const { data } = await apiClient.post<CheckoutResult>("/subscriptions/checkout", {
      planId,
      billingType,
    });
    return data;
  },

  async upgradePlan(planId: string): Promise<Subscription> {
    const { data } = await apiClient.patch<Subscription>("/subscriptions/upgrade", { planId });
    return data;
  },

  async previewUpgrade(planId: string): Promise<UpgradePreview> {
    const { data } = await apiClient.post<UpgradePreview>("/subscriptions/preview-upgrade", { planId });
    return data;
  },

  async cancel(): Promise<void> {
    await apiClient.delete("/subscriptions/cancel");
  },

  async reactivate(): Promise<void> {
    await apiClient.post("/subscriptions/reactivate");
  },

  async getBillingDetails(): Promise<BillingDetails> {
    const { data } = await apiClient.get<BillingDetails>("/subscriptions/billing-details");
    return data;
  },

  async updatePaymentMethod(): Promise<UpdatePaymentMethodResult> {
    const { data } = await apiClient.post<UpdatePaymentMethodResult>("/subscriptions/update-payment-method");
    return data;
  },
};
