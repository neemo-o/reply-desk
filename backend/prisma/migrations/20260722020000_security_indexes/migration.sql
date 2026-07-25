-- 🔴 D1 — Índices em FKs que faltavam (multi-tenant performance).
-- Estes índices não quebram dados existentes: ADICIONAM performance para
-- `where: { tenantId: ... }`queries em milhões de registros.

-- TenantUsers
CREATE INDEX IF NOT EXISTS "tenant_users_tenant_id_idx" ON "tenant_users"("tenant_id");
CREATE INDEX IF NOT EXISTS "tenant_users_role_id_idx" ON "tenant_users"("role_id");

-- Subscriptions / Plans
CREATE INDEX IF NOT EXISTS "subscriptions_tenant_id_idx" ON "subscriptions"("tenant_id");

-- WhatsappSessions
CREATE INDEX IF NOT EXISTS "whatsapp_sessions_tenant_id_idx" ON "whatsapp_sessions"("tenant_id");
CREATE INDEX IF NOT EXISTS "whatsapp_sessions_tenant_id_status_idx" ON "whatsapp_sessions"("tenant_id", "status");

-- SessionSettings composto já existe (session_id). Add index em status atual via session_id (já ok).

-- Bots
CREATE INDEX IF NOT EXISTS "bots_tenant_id_idx" ON "bots"("tenant_id");
CREATE INDEX IF NOT EXISTS "bot_versions_bot_id_idx" ON "bot_versions"("bot_id");
CREATE INDEX IF NOT EXISTS "bot_rules_bot_version_id_idx" ON "bot_rules"("bot_version_id");
CREATE INDEX IF NOT EXISTS "bot_variables_bot_version_id_idx" ON "bot_variables"("bot_version_id");

-- KnowledgeBase
CREATE INDEX IF NOT EXISTS "knowledge_bases_tenant_id_idx" ON "knowledge_bases"("tenant_id");
CREATE INDEX IF NOT EXISTS "knowledge_documents_knowledge_base_id_idx" ON "knowledge_documents"("knowledge_base_id");
CREATE INDEX IF NOT EXISTS "knowledge_chunks_document_id_idx" ON "knowledge_chunks"("document_id");

-- Contacts (phone idx já existe). Add tenant+phone para checagem multi-tenant.
CREATE INDEX IF NOT EXISTS "contacts_tenant_id_phone_idx" ON "contacts"("tenant_id", "phone");

-- Conversations (composto com timestamp já existe). Add status composto.
CREATE INDEX IF NOT EXISTS "conversations_tenant_id_status_idx" ON "conversations"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "conversations_tenant_id_last_message_at_idx" ON "conversations"("tenant_id", "last_message_at" DESC);
CREATE INDEX IF NOT EXISTS "conversations_assigned_user_idx" ON "conversations"("assigned_user");
CREATE INDEX IF NOT EXISTS "conversations_contact_id_idx" ON "conversations"("contact_id");
CREATE INDEX IF NOT EXISTS "conversations_session_id_idx" ON "conversations"("session_id");
CREATE INDEX IF NOT EXISTS "conversation_assignments_conversation_id_idx" ON "conversation_assignments"("conversation_id");
CREATE INDEX IF NOT EXISTS "conversation_assignments_user_id_idx" ON "conversation_assignments"("user_id");
CREATE INDEX IF NOT EXISTS "conversation_notes_conversation_id_idx" ON "conversation_notes"("conversation_id");
CREATE INDEX IF NOT EXISTS "conversation_notes_user_id_idx" ON "conversation_notes"("user_id");

-- Files
CREATE INDEX IF NOT EXISTS "files_tenant_id_idx" ON "files"("tenant_id");

-- Webhooks
CREATE INDEX IF NOT EXISTS "webhooks_tenant_id_idx" ON "webhooks"("tenant_id");

-- ApiKeys (prefix idx já existe).
CREATE INDEX IF NOT EXISTS "api_keys_tenant_id_idx" ON "api_keys"("tenant_id");

-- Jobs (status_type já existe).
CREATE INDEX IF NOT EXISTS "jobs_tenant_id_idx" ON "jobs"("tenant_id");

-- AuditLogs
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_idx" ON "audit_logs"("tenant_id");
CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at" DESC);

-- DailyMetrics (tenant_id+date unique já existe).

-- Roles (tenantId+name unique já existe).
CREATE INDEX IF NOT EXISTS "roles_tenant_id_idx" ON "roles"("tenant_id");

-- Permissions — todas são admin/lib, OK sem índice extra.

-- RefreshTokens (user_id idx já existe).
-- 🟠 S5 — Adicionar índice em expiresAt para o cron de cleanup.
CREATE INDEX IF NOT EXISTS "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");
CREATE INDEX IF NOT EXISTS "refresh_tokens_revoked_idx" ON "refresh_tokens"("revoked");

-- 🔒 S6 — Webhook secret: dados em texto puro existentes serão "abandonados"
-- se você rodar este migration em prod com webhooks já criados. Para MVP com
-- ainda poucos webhooks isso é aceitável; em prod real, recomenda-se rodar uma
-- migration que apaga webhooks existentes (eles são recriados pelos tenants,
-- recebendo novo secret hasheado).
-- O service NUNCA devolve secret em texto puro em findAll/findOne — ver webhooks.service.ts.
