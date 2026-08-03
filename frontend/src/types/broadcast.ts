export interface BroadcastSchedule {
  id: string;
  tenantId: string;
  botId: string;
  contactListId: string;
  mensagem: Record<string, unknown>;
  startAt: string;
  recurrence: "ONCE" | "DAILY" | "WEEKLY";
  status: "scheduled" | "running" | "completed" | "paused";
  totalContacts: number;
  sent: number;
  pending: number;
  failed: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  contactList?: {
    id: string;
    name: string;
  };
  bot?: {
    id: string;
    name: string;
  };
}

export interface BroadcastProgress {
  id: string;
  status: string;
  totalContacts: number;
  sent: number;
  pending: number;
  failed: number;
  lastRunAt: string | null;
  updatedAt: string;
}

export interface CreateBroadcastPayload {
  botId: string;
  contactListId: string;
  mensagem: Record<string, unknown>;
  messageType: "text" | "list" | "buttons" | "media";
  startAt: string;
  recurrence?: "ONCE" | "DAILY" | "WEEKLY";
}