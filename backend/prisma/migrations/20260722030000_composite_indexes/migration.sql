-- ⚡ P-INDEX — Índices compostos essenciais para queries multi-tenant.
-- Estas queries eram Seq Scan antes → agora usam índices direcionais.
--
-- Idempotente: CREATE INDEX IF NOT EXISTS é seguro rodar em prod.

-- Conversations: filtro de listagem padrão (tenant + ordenação temporal)
CREATE INDEX IF NOT EXISTS "conversations_tenant_id_last_message_at_desc_idx"
  ON "conversations"("tenant_id", "last_message_at" DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS "conversations_tenant_id_status_last_message_at_idx"
  ON "conversations"("tenant_id", "status", "last_message_at" DESC NULLS LAST);

-- Messages: pega últimos 50 de uma conversa por timestamp
CREATE INDEX IF NOT EXISTS "messages_conversation_id_timestamp_desc_idx"
  ON "messages"("conversation_id", "timestamp" DESC);

-- Webhooks: filtro por tenant quando eventos precisam ser disparados
CREATE INDEX IF NOT EXISTS "webhooks_tenant_id_events_gin"
  ON "webhooks" USING GIN ("events");

-- Contacts: idx composto (tenant + phone) já criado em migration anterior.
-- Adicional: idx case-insensitive em email só dentro de um tenant.
CREATE INDEX IF NOT EXISTS "contacts_tenant_id_email_low_idx"
  ON "contacts"("tenant_id", (LOWER("email")))
  WHERE "email" IS NOT NULL;

-- Tenants: slug atualmente tem UNIQUE — adicionar índice para lower-case lookups
CREATE INDEX IF NOT EXISTS "tenants_slug_lower_idx"
  ON "tenants"((LOWER("slug")));

-- DailyMetrics: aggregate por tenant + recent. O unique já existe; este composto
-- completa ordering p99 dashboards.
CREATE INDEX IF NOT EXISTS "daily_metrics_tenant_id_date_desc_idx"
  ON "daily_metrics"("tenant_id", "date" DESC);

-- AuditLogs: 90% das consultas são "últimas X" por tenant
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_created_at_desc_idx"
  ON "audit_logs"("tenant_id", "created_at" DESC);

-- RefreshTokens: cron cleanup precisa de `expires_at` ordenado
-- (já existia o IF NOT EXISTS básico; este composto acelera queries específicas)
CREATE INDEX IF NOT EXISTS "refresh_tokens_user_id_active_idx"
  ON "refresh_tokens"("user_id", "revoked", "expires_at");
