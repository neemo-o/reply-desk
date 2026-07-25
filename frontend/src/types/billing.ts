import type { TenantRole } from "./auth";

export interface Plan {
  id: string;
  name: string;
  price: string | number;
  maxSessions: number;
  maxUsers: number;
  maxBots: number;
  maxMessages: number;
  maxStorageMb: number;
  maxAiRequests: number;
}

export type BillingType = "recurring" | "one_time";

export type SubscriptionStatus = "trialing" | "pending" | "active" | "past_due" | "cancelled";

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  billingType: BillingType;
  cancelAtPeriodEnd: boolean;
  trialUntil?: string | null;
  startsAt: string;
  expiresAt?: string | null;
  isActive: boolean;
  plan: Plan;
}

export interface CheckoutResult {
  checkoutUrl: string;
  subscriptionId: string;
  billingType: BillingType;
}

export interface UpgradePreview {
  currentPlan: string | null;
  newPlan: string;
  amountDue: number;
  currency: string;
  isUpgrade: boolean;
}

/** 🔒 M18 — Detalhes do cartão salvo do customer (Stripe). */
export interface PaymentMethodDetails {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

/** 🔒 M18 — Próxima fatura a ser cobrada (upcoming invoice). */
export interface UpcomingInvoice {
  amountDue: number;
  currency: string;
  periodEnd: number;
  lines: Array<{
    description: string;
    amount: number;
    quantity: number;
  }>;
}

/** 🔒 M18 — Fatura do histórico (paga ou pendente). */
export interface InvoiceItem {
  id: string;
  number: string | null;
  status: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  createdAt: number;
  paidAt: number | null;
  invoiceUrl: string | null;
  invoicePdf: string | null;
}

/** 🔒 M18 — Resposta completa de GET /subscriptions/billing-details. */
export interface BillingDetails {
  paymentMethod: PaymentMethodDetails | null;
  upcomingInvoice: UpcomingInvoice | null;
  invoices: InvoiceItem[];
  subscription: {
    status: string;
    planName: string;
    billingType: string;
  };
}

/** 🔒 M18 — Resposta de POST /subscriptions/update-payment-method. */
export interface UpdatePaymentMethodResult {
  checkoutUrl: string;
  sessionId: string;
}

export interface TenantMember {
  id: string;
  tenantId: string;
  userId: string;
  status: string;
  user: { id: string; name: string; email: string };
  role: { name: TenantRole };
}
