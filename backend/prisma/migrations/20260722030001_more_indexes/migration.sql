-- ⚡ P-NORM — WhatsApp phone index;
-- WhatsappSessions status index;
-- Webhooks url lower index (deduplicação).

-- WhatsappSessions composto já existe em migration anterior.
-- Adicionando index p/ queries por session_name (lookup via webhook Evolution):
CREATE INDEX IF NOT EXISTS "whatsapp_sessions_session_name_idx"
  ON "whatsapp_sessions"("session_name");

-- Bots: pra ordenação defaultVersion
CREATE INDEX IF NOT EXISTS "bots_tenant_id_status_idx"
  ON "bots"("tenant_id", "status");

-- BotVersions composto
CREATE INDEX IF NOT EXISTS "bot_versions_bot_published_idx"
  ON "bot_versions"("bot_id", "published");
