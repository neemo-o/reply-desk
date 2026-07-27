-- Migration: tornar (tenant_id, phone) UNIQUE em `contacts`.
-- Necessário para o upsert do webhook da Evolution API no processamento de
-- MESSAGES_UPSERT (findUnique por telefone dentro do tenant). O índice já
-- existia; só tornamos ele único. Sem perda de dados porque a coluna
-- `phone` não tinha valores duplicados na prática (a busca anterior era
-- por índice composto já usado pelo fluxo de contatos).
--
-- Pré-condição defensiva: se houver contatos duplicados por (tenant_id,
-- phone), a constraint não será criada. Nesse cenário, este migration
-- falhará com erro de constraint — esperado e desejado (operação manual
-- necessária antes de subir esta migration).

-- Remove o índice não-único atual
DROP INDEX IF EXISTS "contacts_tenant_id_phone_idx";

-- Cria a constraint única (gera índice único automaticamente)
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_phone_key" UNIQUE ("tenant_id", "phone");
