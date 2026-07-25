-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "avatar" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "last_login" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "max_sessions" INTEGER NOT NULL,
    "max_users" INTEGER NOT NULL,
    "max_bots" INTEGER NOT NULL,
    "max_messages" INTEGER NOT NULL,
    "max_storage_mb" INTEGER NOT NULL,
    "max_ai_requests" INTEGER NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "trial_until" TIMESTAMP(3),
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_sessions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "session_name" TEXT NOT NULL,
    "evolution_instance_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "qr_code" TEXT,
    "last_seen" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_settings" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "webhook_url" TEXT,
    "auto_reconnect" BOOLEAN NOT NULL DEFAULT true,
    "ignore_groups" BOOLEAN NOT NULL DEFAULT true,
    "read_messages" BOOLEAN NOT NULL DEFAULT false,
    "typing_indicator" BOOLEAN NOT NULL DEFAULT true,
    "presence_update" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "session_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "default_version" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_versions" (
    "id" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "description" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "bot_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_rules" (
    "id" TEXT NOT NULL,
    "bot_version_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL,
    "response_type" TEXT NOT NULL,
    "next_rule" TEXT,

    CONSTRAINT "bot_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_variables" (
    "id" TEXT NOT NULL,
    "bot_version_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "default_value" TEXT,

    CONSTRAINT "bot_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_bases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "knowledge_base_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "file_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "avatar" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tags" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,

    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_tag_relations" (
    "contact_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "contact_tag_relations_pkey" PRIMARY KEY ("contact_id","tag_id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "assigned_user" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "last_message_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "external_id" TEXT,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT,
    "media_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_assignments" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "conversation_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_notes" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "storage" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "permissions" TEXT[],
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "scheduled_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resource_id" TEXT,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_metrics" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "messages_in" INTEGER NOT NULL DEFAULT 0,
    "messages_out" INTEGER NOT NULL DEFAULT 0,
    "new_contacts" INTEGER NOT NULL DEFAULT 0,
    "active_conversations" INTEGER NOT NULL DEFAULT 0,
    "human_attendances" INTEGER NOT NULL DEFAULT 0,
    "ai_requests" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_users_tenant_id_user_id_key" ON "tenant_users"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_name_key" ON "roles"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "session_settings_session_id_key" ON "session_settings"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "bot_versions_bot_id_version_key" ON "bot_versions"("bot_id", "version");

-- CreateIndex
CREATE INDEX "contacts_phone_idx" ON "contacts"("phone");

-- CreateIndex
CREATE INDEX "conversations_last_message_at_contact_id_session_id_idx" ON "conversations"("last_message_at", "contact_id", "session_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_timestamp_status_idx" ON "messages"("conversation_id", "timestamp", "status");

-- CreateIndex
CREATE INDEX "api_keys_prefix_idx" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "jobs_status_type_idx" ON "jobs"("status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "daily_metrics_tenant_id_date_key" ON "daily_metrics"("tenant_id", "date");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sessions" ADD CONSTRAINT "whatsapp_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_settings" ADD CONSTRAINT "session_settings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "whatsapp_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bots" ADD CONSTRAINT "bots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_versions" ADD CONSTRAINT "bot_versions_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_rules" ADD CONSTRAINT "bot_rules_bot_version_id_fkey" FOREIGN KEY ("bot_version_id") REFERENCES "bot_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_variables" ADD CONSTRAINT "bot_variables_bot_version_id_fkey" FOREIGN KEY ("bot_version_id") REFERENCES "bot_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_knowledge_base_id_fkey" FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tag_relations" ADD CONSTRAINT "contact_tag_relations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_tag_relations" ADD CONSTRAINT "contact_tag_relations_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "contact_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "whatsapp_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_fkey" FOREIGN KEY ("assigned_user") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_assignments" ADD CONSTRAINT "conversation_assignments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_metrics" ADD CONSTRAINT "daily_metrics_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
