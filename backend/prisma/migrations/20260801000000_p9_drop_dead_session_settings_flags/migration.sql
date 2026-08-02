-- 🔒 P9 — Remove flags de SessionSettings que nunca foram lidas em runtime.
--
-- autoReconnect, ignoreGroups, readMessages, typingIndicator, presenceUpdate:
-- Persistidos via PATCH e expostos na UI como "somente leitura", mas nenhum
-- consumidor runtime. Filtro DM-vs-grupo é hardcoded em
-- evolution-webhooks.service.ts e sempre descarta @g.us/@status@broadcast.
--
-- Sem perda de dados funcionais (esses flags eram defaults fixos).

ALTER TABLE "session_settings"
  DROP COLUMN "auto_reconnect",
  DROP COLUMN "ignore_groups",
  DROP COLUMN "read_messages",
  DROP COLUMN "typing_indicator",
  DROP COLUMN "presence_update";
