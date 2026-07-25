-- Migration: payment_subscriptions
-- Adiciona campos de integração Mercado Pago à tabela subscriptions
-- e cria a tabela payment_webhook_events para idempotência de webhooks.

-- AlterTable: subscriptions
ALTER TABLE "subscriptions" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'mercadopago';
ALTER TABLE "subscriptions" ADD COLUMN "external_id" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "last_payment_id" TEXT;
ALTER TABLE "subscriptions" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "subscriptions" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- DropIndex: subscriptions_tenant_id_idx (índice antigo de coluna única)
DROP INDEX IF EXISTS "subscriptions_tenant_id_idx";

-- CreateIndex: unique external_id (garante que uma assinatura MP não seja vinculada duas vezes)
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_external_id_key" ON "subscriptions"("external_id");

-- CreateIndex: consulta subscription ativa por tenant + status
CREATE INDEX IF NOT EXISTS "subscriptions_tenant_id_status_idx" ON "subscriptions"("tenant_id", "status");

-- CreateTable: payment_webhook_events
CREATE TABLE IF NOT EXISTS "payment_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'mercadopago',
    "external_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: idempotência — (provider, external_id) único
CREATE UNIQUE INDEX IF NOT EXISTS "payment_webhook_events_provider_external_id_key"
    ON "payment_webhook_events"("provider", "external_id");

-- Trigger opcional para updated_at em subscriptions (mantém updatedAt automático)
CREATE OR REPLACE FUNCTION subscriptions_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subscriptions_updated_at_trigger ON "subscriptions";
CREATE TRIGGER subscriptions_updated_at_trigger
    BEFORE UPDATE ON "subscriptions"
    FOR EACH ROW
    EXECUTE FUNCTION subscriptions_set_updated_at();
