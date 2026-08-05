-- Bug 2: Move offlineMessage/welcomeMessage do Bot para o Tenant.
--   - Adiciona tenants.offline_message, tenants.welcome_message.
--   - Migra dados existentes: bots.offline_message -> tenants.offline_message
--     (pega o primeiro bot com offline_message não-null e copia pro tenant).
--   - Mantém bots.offline_message (deprecated, fallback) para retrocompat.
-- Bug 3: Adiciona bot_sessions.last_sent_at (cooldown do bot SIMPLE).
-- Bug 6: Adiciona plan limits por tipo e ativos:
--   - plans.max_bots_per_type (default 1)
--   - plans.max_active_bots (default 1)

-- 1. Tenant: offline_message + welcome_message
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "offline_message"  TEXT,
  ADD COLUMN IF NOT EXISTS "welcome_message" TEXT;

-- Migra offline_message do primeiro bot (não-null) para o tenant.
-- Um tenant pode ter vários bots cada um com sua offline_message — adotamos
-- "last wins" (ORDER BY created_at DESC) e copiamos só o último não-nulo.
UPDATE "tenants" t
  SET "offline_message" = sub."offline_message"
  FROM (
    SELECT DISTINCT ON (b."tenant_id")
      b."tenant_id",
      b."offline_message"
    FROM "bots" b
    WHERE b."offline_message" IS NOT NULL
      AND b."offline_message" <> ''
    ORDER BY b."tenant_id", b."created_at" DESC
  ) sub
  WHERE t."id" = sub."tenant_id"
    AND t."offline_message" IS NULL;

-- 2. BotSession: last_sent_at (cooldown do bot SIMPLE)
ALTER TABLE "bot_sessions"
  ADD COLUMN IF NOT EXISTS "last_sent_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "bot_sessions_bot_id_status_last_sent_at_idx"
  ON "bot_sessions" ("bot_id", "status", "last_sent_at");

-- 3. Plan: max_bots_per_type + max_active_bots
ALTER TABLE "plans"
  ADD COLUMN IF NOT EXISTS "max_bots_per_type" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "max_active_bots"   INTEGER NOT NULL DEFAULT 1;

-- Atualiza planos existentes (basic=1/1, premium=3/3) se ainda estão em default.
-- Naming: 'basic-plan' e 'premium-plan' são IDs criados no seed.
UPDATE "plans"
  SET "max_bots_per_type" = 1, "max_active_bots" = 1
  WHERE "id" = 'basic-plan'
    AND "max_bots_per_type" = 1
    AND "max_active_bots" = 1;

UPDATE "plans"
  SET "max_bots_per_type" = 3, "max_active_bots" = 3
  WHERE "id" = 'premium-plan';
