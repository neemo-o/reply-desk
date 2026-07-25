-- Migration: unique_active_subscription
-- Defense-in-depth contra race condition no createCheckout (P1).
-- Garante que cada tenant só tenha UMA assinatura pendente/ativa/trialing
-- por vez. Multiple registros cancelados/expirados são permitidos (histórico).
--
-- O lock pessimista no código (SELECT ... FOR UPDATE) já serializa a operação,
-- mas esta constraint age como safety net caso o lock falhe (ex.: bug futuro
-- que rode checkout fora de transação).

-- Constraint parcial: unique(tenant_id) WHERE status IN ('pending','active','trialing')
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_tenant_active_unique_idx"
    ON "subscriptions" ("tenant_id")
    WHERE status IN ('pending', 'active', 'trialing');
