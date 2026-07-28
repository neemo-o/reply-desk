-- Migration: S23 — Logs de conexão por sessão + cleanup da coluna `phone`
-- no momento da criação.
--
-- Motivação:
--   1. "Logs temporários" mostrados nos detalhes da sessão hoje são mensagens
--      do WhatsApp — não tem nada a ver com a CONEXÃO da sessão. Esta migration
--      cria uma tabela `session_events` que guarda eventos de conexão
--      (qrcode_pending, connected, disconnected, error, etc.) por sessão,
--      substituindo o uso indevido do inbox como log de conexão.
--   2. O número do WhatsApp é atribuído automaticamente quando o QR é
--      escaneado (Evolution retorna via CONNECTION_UPDATE.wid.user). O
--      campo `phone` da whatsapp_session continua existindo, mas agora é
--      preenchido APENAS pelo webhook — o DTO de criação deixa de aceitá-lo.
--      O índice por `phone` é removido para evitar custo de upkeep em coluna
--      que será atualizada poucas vezes (1x por conexão).
--
-- Compat: sessões já existentes mantêm o phone que tinham. O DTO é alterado
-- em código; o índice é dropped aqui.

-- CreateTable: session_events
-- Log de eventos de conexão por sessão (status, código do WhatsApp, phone,
-- motivo de disconnect, etc.). Ordenado por created_at desc; paginação por
-- cursor (id) ou take.
CREATE TABLE "session_events" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "session_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,                  -- qrcode_pending | connected | disconnected | error | created | deleted | logout
    "status_code" INTEGER,                 -- HTTP/WhatsApp code (401, 408, 440, ...)
    "phone" TEXT,                          -- número conectado quando aplicável
    "message" TEXT,                        -- descrição legível
    "metadata" JSONB,                      -- payload cru da Evolution (opcional, p/ debug)
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "session_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: listagem por sessão, ordem cronológica desc
CREATE INDEX "session_events_session_id_created_at_idx" ON "session_events"("session_id", "created_at" DESC);
CREATE INDEX "session_events_tenant_id_created_at_idx" ON "session_events"("tenant_id", "created_at" DESC);
CREATE INDEX "session_events_type_idx" ON "session_events"("type");

-- AddForeignKey
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "whatsapp_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- (sem DROP de índice — whatsapp_sessions.phone nunca teve índice; quem
-- tem `@@index([phone])` é o model `Contact`, fora do escopo desta migration)
