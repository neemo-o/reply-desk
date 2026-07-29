// 🤖 Types de Bot — espelham GET/POST /api/v1/bots.
//
// A feature S24 usa o `status='active'` como sinal de "publicado".
// O backend valida no POST /whatsapp/sessions que activeBotId
// referencia um bot com status='active' no mesmo tenant.

export type BotStatus = "draft" | "active";

export interface BotVersion {
  id: string;
  version: number;
  description?: string | null;
  published: boolean;
}

export interface Bot {
  id: string;
  tenantId?: string;
  name: string;
  description?: string | null;
  status: BotStatus;
  defaultVersion?: number | null;
  createdAt: string;
  updatedAt?: string;
  versions?: BotVersion[];
}
