export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string | null;
  emailVerified: boolean;
  createdAt?: string;
}

export type TenantRole = "owner" | "admin" | "agent";

export interface TenantSubscriptionSummary {
  status: string;
  plan?: string;
  isActive: boolean;
  trialUntil?: string | null;
  expiresAt?: string | null;
}

export interface MeTenant {
  id: string;
  name: string;
  slug: string;
  role: TenantRole;
  subscription: TenantSubscriptionSummary | null;
}

export interface MeSnapshot {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
  };
  tenants: MeTenant[];
  /** 🔒 S4 — Sessão atual (previsão de expiração do refresh token do DB). */
  session?: {
    refreshExpiresAt: string;
    refreshExpiresInSec: number;
  } | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** 🔒 S4 — expiração do access token (segundos desde epoch). Opcional para
   * não quebrar clientes legados que não esperam esse campo. */
  accessTokenExp?: number;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
}
