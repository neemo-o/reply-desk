-- 🔒 S4 — Grace period para refresh token rotation.
-- Adiciona coluna `replaced_at` na tabela refresh_tokens.
--
-- Quando um refresh token é rotacionado (POST /auth/refresh), NÃO revogamos
-- imediatamente (revoked=true). Em vez disso, marcamos `replaced_at = NOW()`.
-- O token antigo continua aceito por JWT_REFRESH_GRACE_MS (default 30s),
-- permitindo que múltiplas abas/dispositivos com o mesmo refresh token
-- façam refresh concorrentemente sem queda de sessão.
--
-- Após o grace, o cleanup job remove o registro; tentativa de uso depois disso
-- é tratada como token expirado → 401 → usuário precisa logar de novo (mas
-- só depois DE verdadeiramente ter expirado, não por race condition).
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "replaced_at" TIMESTAMP(3);

-- Index para acelerar a checagem de grace period (WHERE replaced_at > NOW() - interval)
CREATE INDEX IF NOT EXISTS "refresh_tokens_replaced_at_idx" ON "refresh_tokens" ("replaced_at");
