-- Refatoração do escopo de bots em 3 tipos: SIMPLE, AGENTS, AUTO.
-- 1. Renomeia types existentes: CONVENTIONAL -> AGENTS, BROADCAST -> AUTO.
-- 2. Remove legado S24: bot_versions, bot_rules, bot_variables, default_version,
--    session_settings.active_bot_version_id (+ FK).
-- 3. Adiciona colunas em bots: test_contact_phone, offline_message.
-- 4. Adiciona business_hours (JSONB) em tenants.
-- 5. Adiciona recorrencia MONTHLY ao enum de broadcast_schedules (string, sem check).
-- Observação: o `type` é string livre; fazemos o rename via UPDATE.

-- 1. Renomeia types de bots existentes.
UPDATE "bots" SET "type" = 'AGENTS' WHERE "type" = 'CONVENTIONAL';
UPDATE "bots" SET "type" = 'AUTO'    WHERE "type" = 'BROADCAST';

-- 2. Remoção do legado S24 (tabelas + campos órfãos).
ALTER TABLE "session_settings" DROP CONSTRAINT IF EXISTS "session_settings_active_bot_version_id_fkey";
ALTER TABLE "session_settings" DROP COLUMN IF EXISTS "active_bot_version_id";

ALTER TABLE "bots" DROP COLUMN IF EXISTS "default_version";

DROP TABLE IF EXISTS "bot_variables";
DROP TABLE IF EXISTS "bot_rules";
DROP TABLE IF EXISTS "bot_versions";

-- 3. Bots: modo de teste (contato de teste) + mensagem de fora de horário.
ALTER TABLE "bots"
  ADD COLUMN IF NOT EXISTS "test_contact_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "offline_message"    TEXT;

-- 4. Tenant: business hours (JSONB nulo = sem horário definido = sempre atende).
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "business_hours" JSONB;
