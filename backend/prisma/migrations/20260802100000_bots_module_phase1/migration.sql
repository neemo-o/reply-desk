-- Fase 1: módulo de Bots (convencional + broadcast)
-- Adiciona type/relações ao Bot existente e cria tabelas novas.

-- Bot: adiciona coluna `type` (default CONVENTIONAL para compat com linhas existentes).
ALTER TABLE "bots"
  ADD COLUMN "type" TEXT NOT NULL DEFAULT 'CONVENTIONAL';

CREATE INDEX "bots_tenant_id_type_idx" ON "bots" ("tenant_id", "type");

-- BotTrigger
CREATE TABLE "bot_triggers" (
    "id"    TEXT   NOT NULL,
    "bot_id" TEXT   NOT NULL,
    "tipo"  TEXT   NOT NULL,
    "valor" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_triggers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bot_triggers_bot_id_idx" ON "bot_triggers" ("bot_id");
ALTER TABLE "bot_triggers"
  ADD CONSTRAINT "bot_triggers_bot_id_fkey"
  FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE;

-- BotStep
CREATE TABLE "bot_steps" (
    "id"                  TEXT   NOT NULL,
    "bot_id"              TEXT   NOT NULL,
    "ordem"               INTEGER NOT NULL,
    "tipo_mensagem"       TEXT   NOT NULL,
    "conteudo"            JSONB  NOT NULL,
    "condicoes_proximo"   JSONB,
    "fallback_step_order" INTEGER,

    CONSTRAINT "bot_steps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_steps_bot_id_ordem_key" ON "bot_steps" ("bot_id", "ordem");
CREATE INDEX "bot_steps_bot_id_idx" ON "bot_steps" ("bot_id");
ALTER TABLE "bot_steps"
  ADD CONSTRAINT "bot_steps_bot_id_fkey"
  FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE;

-- BotSession
CREATE TABLE "bot_sessions" (
    "id"              TEXT      NOT NULL,
    "bot_id"          TEXT      NOT NULL,
    "contact_id"      TEXT      NOT NULL,
    "tenant_id"       TEXT      NOT NULL,
    "current_step_id" TEXT,
    "status"          TEXT      NOT NULL DEFAULT 'active',
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_sessions_bot_id_contact_id_key" ON "bot_sessions" ("bot_id", "contact_id");
CREATE INDEX "bot_sessions_tenant_id_status_idx" ON "bot_sessions" ("tenant_id", "status");
CREATE INDEX "bot_sessions_contact_id_idx" ON "bot_sessions" ("contact_id");
ALTER TABLE "bot_sessions"
  ADD CONSTRAINT "bot_sessions_bot_id_fkey"
  FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE;
ALTER TABLE "bot_sessions"
  ADD CONSTRAINT "bot_sessions_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE;
ALTER TABLE "bot_sessions"
  ADD CONSTRAINT "bot_sessions_current_step_id_fkey"
  FOREIGN KEY ("current_step_id") REFERENCES "bot_steps"("id") ON DELETE SET NULL;

-- ContactList
CREATE TABLE "contact_lists" (
    "id"         TEXT      NOT NULL,
    "tenant_id"  TEXT      NOT NULL,
    "name"       TEXT      NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_lists_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contact_lists_tenant_id_idx" ON "contact_lists" ("tenant_id");
ALTER TABLE "contact_lists"
  ADD CONSTRAINT "contact_lists_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

-- ContactListItem
CREATE TABLE "contact_list_items" (
    "id"               TEXT NOT NULL,
    "contact_list_id"  TEXT NOT NULL,
    "contact_id"       TEXT NOT NULL,

    CONSTRAINT "contact_list_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contact_list_items_contact_list_id_contact_id_key"
  ON "contact_list_items" ("contact_list_id", "contact_id");
CREATE INDEX "contact_list_items_contact_list_id_idx" ON "contact_list_items" ("contact_list_id");
CREATE INDEX "contact_list_items_contact_id_idx" ON "contact_list_items" ("contact_id");
ALTER TABLE "contact_list_items"
  ADD CONSTRAINT "contact_list_items_contact_list_id_fkey"
  FOREIGN KEY ("contact_list_id") REFERENCES "contact_lists"("id") ON DELETE CASCADE;
ALTER TABLE "contact_list_items"
  ADD CONSTRAINT "contact_list_items_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE;

-- BroadcastSchedule
CREATE TABLE "broadcast_schedules" (
    "id"                TEXT      NOT NULL,
    "tenant_id"         TEXT      NOT NULL,
    "bot_id"            TEXT      NOT NULL,
    "contact_list_id"   TEXT      NOT NULL,
    "mensagem"          JSONB     NOT NULL,
    "start_at"          TIMESTAMP(3) NOT NULL,
    "recurrence"        TEXT      NOT NULL DEFAULT 'ONCE',
    "status"            TEXT      NOT NULL DEFAULT 'scheduled',
    "total_contacts"   INTEGER   NOT NULL DEFAULT 0,
    "sent"              INTEGER   NOT NULL DEFAULT 0,
    "pending"           INTEGER   NOT NULL DEFAULT 0,
    "failed"            INTEGER   NOT NULL DEFAULT 0,
    "last_run_at"       TIMESTAMP(3),
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,

    CONSTRAINT "broadcast_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "broadcast_schedules_tenant_id_status_idx" ON "broadcast_schedules" ("tenant_id", "status");
CREATE INDEX "broadcast_schedules_start_at_idx" ON "broadcast_schedules" ("start_at");
ALTER TABLE "broadcast_schedules"
  ADD CONSTRAINT "broadcast_schedules_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "broadcast_schedules"
  ADD CONSTRAINT "broadcast_schedules_bot_id_fkey"
  FOREIGN KEY ("bot_id") REFERENCES "bots"("id") ON DELETE CASCADE;
ALTER TABLE "broadcast_schedules"
  ADD CONSTRAINT "broadcast_schedules_contact_list_id_fkey"
  FOREIGN KEY ("contact_list_id") REFERENCES "contact_lists"("id") ON DELETE RESTRICT;

-- MessageLog
CREATE TABLE "message_logs" (
    "id"             TEXT      NOT NULL,
    "tenant_id"      TEXT      NOT NULL,
    "bot_id"         TEXT,
    "bot_session_id" TEXT,
    "broadcast_id"   TEXT,
    "contact_id"     TEXT,
    "direction"      TEXT      NOT NULL,
    "type"           TEXT      NOT NULL,
    "content"        JSONB,
    "status"         TEXT      NOT NULL DEFAULT 'pending',
    "external_id"    TEXT,
    "error"          TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "message_logs_tenant_id_created_at_idx" ON "message_logs" ("tenant_id", "created_at");
CREATE INDEX "message_logs_bot_session_id_idx" ON "message_logs" ("bot_session_id");
CREATE INDEX "message_logs_broadcast_id_idx" ON "message_logs" ("broadcast_id");
CREATE INDEX "message_logs_contact_id_idx" ON "message_logs" ("contact_id");
ALTER TABLE "message_logs"
  ADD CONSTRAINT "message_logs_bot_session_id_fkey"
  FOREIGN KEY ("bot_session_id") REFERENCES "bot_sessions"("id") ON DELETE SET NULL;
ALTER TABLE "message_logs"
  ADD CONSTRAINT "message_logs_broadcast_id_fkey"
  FOREIGN KEY ("broadcast_id") REFERENCES "broadcast_schedules"("id") ON DELETE SET NULL;
