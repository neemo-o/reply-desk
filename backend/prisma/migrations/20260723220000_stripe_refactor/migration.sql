-- Migration: stripe_refactor
-- Migra o fluxo de pagamento de Mercado Pago para Stripe.
-- Adiciona campos de Stripe aos planos e billing_type às subscriptions.

-- AlterTable: plans — adiciona price IDs do Stripe
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "stripe_price_recurring_id" TEXT;
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "stripe_price_one_time_id" TEXT;

-- AlterTable: subscriptions — adiciona billing_type + muda provider default
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billing_type" TEXT NOT NULL DEFAULT 'recurring';
ALTER TABLE "subscriptions" ALTER COLUMN "provider" SET DEFAULT 'stripe';

-- AlterTable: payment_webhook_events — muda provider default
ALTER TABLE "payment_webhook_events" ALTER COLUMN "provider" SET DEFAULT 'stripe';

-- Atualiza registros legados de intercambiable provider mercadopago → stripe
-- (subscriptions e payment_webhook_events criados antes da refatoração)
UPDATE "subscriptions" SET "provider" = 'stripe' WHERE "provider" = 'mercadopago';
UPDATE "payment_webhook_events" SET "provider" = 'stripe' WHERE "provider" = 'mercadopago';
