-- Migration: Evolution API integration
-- Remove QR Code do PostgreSQL (fica só na Evolution API) e adiciona
-- webhook_secret_hash para validar assinatura por instância dos webhooks.
--
-- Acredite em memória: o qr_code nunca foi usado em produção ainda (schema
-- novo) — removemos a coluna sem backfill.

-- Remove a coluna qr_code — o QR Code é buscado sob demanda na Evolution API
ALTER TABLE "whatsapp_sessions" DROP COLUMN IF EXISTS "qr_code";

-- Adiciona coluna webhook_secret_hash (hash argon2 do secret por sessão)
ALTER TABLE "whatsapp_sessions" ADD COLUMN IF NOT EXISTS "webhook_secret_hash" TEXT;
