export type BotType = "CONVENTIONAL" | "BROADCAST";
export type BotStatus = "draft" | "active" | "inactive";

export interface BotVersion {
  id: string;
  version: number;
  description?: string | null;
  published: boolean;
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

export interface BotStep {
  id: string;
  ordem: number;
  tipoMensagem: "text" | "list" | "buttons" | "media";
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
  defaultVersion?: number | null;
  createdAt: string;
  updatedAt?: string;
  versions?: BotVersion[];
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
}

export interface UpdateBotPayload {
  name?: string;
  description?: string;
  type?: BotType;
  status?: BotStatus;
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
  tipoMensagem: "text" | "list" | "buttons" | "media";
  conteudo: Record<string, unknown>;
  condicoesProximo?: BotStepCondition[];
  fallbackStepOrder?: number;
}

export interface UpdateBotStepPayload {
  ordem?: number;
  tipoMensagem?: "text" | "list" | "buttons" | "media";
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
  finalStatus: "finished" | "waiting" | "error";
  visitedSteps: number[];
}

export interface TestBotPayload {
  startMessage?: string;
  userMessages?: string[];
}