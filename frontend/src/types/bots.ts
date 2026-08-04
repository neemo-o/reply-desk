export type BotType = "SIMPLE" | "AGENTS" | "AUTO";
export type BotStatus = "draft" | "testing" | "active" | "inactive";

/// Configuração de horário de atendimento do tenant.
/// businessHours null = 24/7.
export interface BusinessHoursDay {
  dayOfWeek: number; // 0=domingo..6=sábado
  open: string; // "HH:mm"
  close: string; // "HH:mm"
}
export interface BusinessHours {
  days: BusinessHoursDay[];
  timezone?: string;
}

export interface BotTrigger {
  id: string;
  tipo: "keyword" | "first_message";
  valor: string | null;
}

export interface BotStepCondition {
  match: string;
  stepOrder: number;
}

export type StepMessageType = "text" | "list" | "buttons" | "media" | "handoff";

export interface BotStep {
  id: string;
  ordem: number;
  tipoMensagem: StepMessageType;
  conteudo: Record<string, unknown>;
  condicoesProximo: BotStepCondition[] | null;
  fallbackStepOrder: number | null;
}

export interface Bot {
  id: string;
  tenantId?: string;
  name: string;
  description?: string | null;
  type: BotType;
  status: BotStatus;
  testContactPhone?: string | null;
  offlineMessage?: string | null;
  createdAt: string;
  updatedAt?: string;
  triggers?: BotTrigger[];
  steps?: BotStep[];
  _count?: {
    sessions: number;
    broadcasts: number;
  };
}

export interface CreateBotPayload {
  name: string;
  description?: string;
  type: BotType;
  testContactPhone?: string;
  offlineMessage?: string;
}

export interface UpdateBotPayload {
  name?: string;
  description?: string;
  type?: BotType;
  status?: BotStatus;
  testContactPhone?: string | null;
  offlineMessage?: string | null;
}

export interface CreateBotTriggerPayload {
  tipo: "keyword" | "first_message";
  valor?: string;
}

export interface UpdateBotTriggerPayload {
  tipo?: "keyword" | "first_message";
  valor?: string;
}

export interface CreateBotStepPayload {
  ordem: number;
  tipoMensagem: StepMessageType;
  conteudo: Record<string, unknown>;
  condicoesProximo?: BotStepCondition[];
  fallbackStepOrder?: number;
}

export interface UpdateBotStepPayload {
  ordem?: number;
  tipoMensagem?: StepMessageType;
  conteudo?: Record<string, unknown>;
  condicoesProximo?: BotStepCondition[];
  fallbackStepOrder?: number;
}

export interface SandboxEvent {
  direction: "bot" | "user";
  type: string;
  text?: string;
  selectedId?: string;
  timestamp: string;
}

export interface SandboxResult {
  events: SandboxEvent[];
  finalStatus: "finished" | "routed" | "waiting" | "error" | "offline";
  visitedSteps: number[];
}

export interface TestBotPayload {
  startMessage?: string;
  userMessages?: string[];
}

// Broadcasts (bot AUTO)
export type BroadcastRecurrence = "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY";

export interface BroadcastSchedule {
  id: string;
  tenantId?: string;
  botId: string;
  contactListId: string;
  mensagem: Record<string, unknown>;
  startAt: string;
  recurrence: BroadcastRecurrence;
  status: "scheduled" | "running" | "completed" | "paused";
  totalContacts: number;
  sent: number;
  pending: number;
  failed: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBroadcastPayload {
  botId: string;
  contactListId: string;
  mensagem: Record<string, unknown>;
  messageType: "text" | "list" | "buttons" | "media";
  startAt: string;
  recurrence?: BroadcastRecurrence;
}

export interface ContactList {
  id: string;
  tenantId?: string;
  name: string;
  createdAt: string;
  _count?: { items: number };
}
