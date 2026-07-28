-- AddColumn: invitations.expires_at
-- Convites pendentes antigos nunca expiravam e eram consumidos por qualquer
-- cadastro futuro com o mesmo e-mail. Linhas existentes ganham 7 dias a
-- partir de agora; novos convites recebem o mesmo prazo a partir da criação.
ALTER TABLE "invitations"
    ADD COLUMN "expires_at" TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days');

CREATE INDEX "invitations_email_status_expires_at_idx" ON "invitations"("email", "status", "expires_at");
