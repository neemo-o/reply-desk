/*
  Warnings:

  - A unique constraint covering the columns `[conversation_id,external_id]` on the table `messages` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "conversation_notes" DROP CONSTRAINT "conversation_notes_user_id_fkey";

-- DropIndex
DROP INDEX "api_keys_tenant_id_idx";

-- DropIndex
DROP INDEX "audit_logs_tenant_id_created_at_desc_idx";

-- DropIndex
DROP INDEX "audit_logs_tenant_id_created_at_idx";

-- DropIndex
DROP INDEX "audit_logs_tenant_id_idx";

-- DropIndex
DROP INDEX "bot_rules_bot_version_id_idx";

-- DropIndex
DROP INDEX "bot_variables_bot_version_id_idx";

-- DropIndex
DROP INDEX "bot_versions_bot_id_idx";

-- DropIndex
DROP INDEX "bots_tenant_id_idx";

-- DropIndex
DROP INDEX "conversation_notes_user_id_idx";

-- DropIndex
DROP INDEX "conversations_assigned_user_idx";

-- DropIndex
DROP INDEX "conversations_session_id_idx";

-- DropIndex
DROP INDEX "conversations_tenant_id_last_message_at_desc_idx";

-- DropIndex
DROP INDEX "conversations_tenant_id_last_message_at_idx";

-- DropIndex
DROP INDEX "conversations_tenant_id_status_last_message_at_idx";

-- DropIndex
DROP INDEX "daily_metrics_tenant_id_date_desc_idx";

-- DropIndex
DROP INDEX IF EXISTS "files_tenant_id_created_at_idx";

-- DropIndex
DROP INDEX "files_tenant_id_idx";

-- DropIndex
DROP INDEX "jobs_tenant_id_idx";

-- DropIndex
DROP INDEX "knowledge_bases_tenant_id_idx";

-- DropIndex
DROP INDEX "knowledge_chunks_document_id_idx";

-- DropIndex
DROP INDEX "knowledge_documents_knowledge_base_id_idx";

-- DropIndex
DROP INDEX "messages_conversation_id_timestamp_desc_idx";

-- DropIndex
DROP INDEX "refresh_tokens_revoked_idx";

-- DropIndex
DROP INDEX "subscriptions_tenant_id_idx";

-- DropIndex
DROP INDEX "webhooks_tenant_id_events_gin";

-- DropIndex
DROP INDEX "whatsapp_sessions_session_name_idx";

-- DropIndex
DROP INDEX "whatsapp_sessions_tenant_id_idx";

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_last_message_at_idx" ON "conversations"("tenant_id", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_assigned_user_idx" ON "conversations"("tenant_id", "assigned_user");

-- CreateIndex
CREATE INDEX "files_tenant_id_created_at_idx" ON "files"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_timestamp_idx" ON "messages"("conversation_id", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversation_id_external_id_key" ON "messages"("conversation_id", "external_id");

-- CreateIndex
CREATE INDEX "tenant_users_user_id_idx" ON "tenant_users"("user_id");

-- AddForeignKey
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
