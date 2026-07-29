-- 🔒 Adiciona coluna profile_name à tabela whatsapp_sessions.
-- O webhook CONNECTION_UPDATE da Evolution API traz esse campo quando o QR
-- é escaneado (ex.: "Empresa XY"); sem ele o usuário só vê o número. A UI
-- mostra "75 9 1234-5678 (Empresa XY)" quando a coluna está preenchida.
ALTER TABLE "whatsapp_sessions"
  ADD COLUMN "profile_name" TEXT;

-- 🔒 Índice opcional por (tenant_id, profile_name) é desnecessário (não filtra
-- por nome); o índice composto (tenant_id, status) já cobre listagem.
