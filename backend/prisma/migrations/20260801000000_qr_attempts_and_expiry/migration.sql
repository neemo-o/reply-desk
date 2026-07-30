-- 🔒 S25 — Limite de tentativas de QR Code e status 'qr_expired'.
--
-- Problema: o usuário escaneia o QR, mas o frontend continua polling
-- /sessions/:id/qr a cada 2s, e cada poll chama /instance/connect na
-- Evolution — que RECRIA a sessão Baileys e derruba a conexão recém
-- estabelecida. Resultado: parece que conecta e desconecta em segundos.
--
-- Solução (S25):
--  - qrAttempts        contador de QR Codes gerados sem scan
--  - qrLastGeneratedAt debouncing de polling (se < EVOLUTION_QR_DEBOUNCE_MS,
--                       devolve o QR cacheado em vez de chamar Evolution)
--  - status='qr_expired'  estado terminal após EVOLUTION_QR_MAX_ATTEMPTS
--
-- Os dois novos campos têm default no DB para não quebrar sessões já
-- existentes em produção. Backend zera qrAttempts em connect/reconnect
-- e em CONNECTION_UPDATE state=open.

ALTER TABLE "whatsapp_sessions"
  ADD COLUMN IF NOT EXISTS "qr_attempts"          INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "qr_last_generated_at" TIMESTAMP(3);
