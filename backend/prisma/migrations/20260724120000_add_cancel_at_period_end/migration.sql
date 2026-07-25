-- 🔒 Adiciona coluna cancel_at_period_end na tabela subscriptions.
-- true = usuário pediu cancelamento, mas mantém acesso até expiresAt.
-- O webhook customer.subscription.deleted do Stripe marca como false + status 'cancelled'.
ALTER TABLE "subscriptions" ADD COLUMN "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false;
