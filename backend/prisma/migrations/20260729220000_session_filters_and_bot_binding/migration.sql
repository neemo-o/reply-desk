-- 🔒 S24 — Filtros por sessão (whitelist/blacklist) + binding de bot ativo.
-- 1) Adiciona campos em session_settings (nullable, com defaults seguros).
-- 2) Cria nova tabela session_contact_list_items (whitelist/blacklist).
-- 3) Tudo é backfill-safe: sessões existentes ficam com contactFilterMode='none'
--    e sem bot ativo, mantendo o comportamento legado.

-- 1) session_settings: novas colunas
ALTER TABLE "session_settings"
  ADD COLUMN "contact_filter_mode" TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN "active_bot_id" TEXT,
  ADD COLUMN "active_bot_version_id" TEXT;

-- 1.1) FKs (SetNull pra não bloquear exclusão de bot — sessão volta pra 'draft')
ALTER TABLE "session_settings"
  ADD CONSTRAINT "session_settings_active_bot_id_fkey"
    FOREIGN KEY ("active_bot_id") REFERENCES "bots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "session_settings"
  ADD CONSTRAINT "session_settings_active_bot_version_id_fkey"
    FOREIGN KEY ("active_bot_version_id") REFERENCES "bot_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 1.2) Índice pra acelerar lookup de settings por bot (admin/debug)
CREATE INDEX "session_settings_active_bot_id_idx" ON "session_settings"("active_bot_id");

-- 2) Nova tabela: lista de contatos da sessão (whitelist/blacklist)
CREATE TABLE "session_contact_list_items" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "list" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "session_contact_list_items_pkey" PRIMARY KEY ("id")
);

-- 2.1) FKs (Cascade — deletou sessão ou contato, some da lista)
ALTER TABLE "session_contact_list_items"
  ADD CONSTRAINT "session_contact_list_items_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "whatsapp_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_contact_list_items"
  ADD CONSTRAINT "session_contact_list_items_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2.2) Constraints + índices
-- Não duplicar (sessão, contato, lista): o mesmo contato pode estar nas
-- duas listas simultaneamente, mas só 1× por lista.
CREATE UNIQUE INDEX "session_contact_list_items_session_id_contact_id_list_key"
  ON "session_contact_list_items"("session_id", "contact_id", "list");

-- Lookup rápido no inbound webhook (sessionId, contactId) por lista.
-- Antes do filter, o onMessagesUpsert faz:
--   SELECT list FROM session_contact_list_items
--    WHERE session_id=$1 AND contact_id=$2;
-- Esse índice cobre a query por (session_id, contact_id) e ainda filtra por list.
CREATE INDEX "session_contact_list_items_session_id_contact_id_idx"
  ON "session_contact_list_items"("session_id", "contact_id");

-- Listagem por lista na UI: GET /sessions/:id/settings/contacts?list=whitelist
CREATE INDEX "session_contact_list_items_session_id_list_idx"
  ON "session_contact_list_items"("session_id", "list");
