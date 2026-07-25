-- CreateTable: invitations
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "invited_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tenant_id_email_key" ON "invitations"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "invitations_email_status_idx" ON "invitations"("email", "status");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
