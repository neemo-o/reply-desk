import { apiClient } from "./api-client";
import type {
  Bot,
  BotStep,
  BotTrigger,
  CreateBotPayload,
  CreateBotStepPayload,
  CreateBotTriggerPayload,
  SandboxResult,
  TestBotPayload,
  UpdateBotPayload,
  UpdateBotStepPayload,
  UpdateBotTriggerPayload,
} from "@/types/bots";

export const botsService = {
  async list(): Promise<Bot[]> {
    const { data } = await apiClient.get<Bot[]>("/bots");
    return data;
  },

  async getOne(id: string): Promise<Bot> {
    const { data } = await apiClient.get<Bot>(`/bots/${id}`);
    return data;
  },

  async create(payload: CreateBotPayload): Promise<Bot> {
    const { data } = await apiClient.post<Bot>("/bots", payload);
    return data;
  },

  async update(id: string, payload: UpdateBotPayload): Promise<Bot> {
    const { data } = await apiClient.patch<Bot>(`/bots/${id}`, payload);
    return data;
  },

  async remove(id: string): Promise<{ success: boolean }> {
    const { data } = await apiClient.delete<{ success: boolean }>(`/bots/${id}`);
    return data;
  },

  // triggers
  async createTrigger(botId: string, payload: CreateBotTriggerPayload): Promise<BotTrigger> {
    const { data } = await apiClient.post<BotTrigger>(`/bots/${botId}/triggers`, payload);
    return data;
  },

  async updateTrigger(botId: string, triggerId: string, payload: UpdateBotTriggerPayload): Promise<BotTrigger> {
    const { data } = await apiClient.patch<BotTrigger>(`/bots/${botId}/triggers/${triggerId}`, payload);
    return data;
  },

  async removeTrigger(botId: string, triggerId: string): Promise<{ success: boolean }> {
    const { data } = await apiClient.delete<{ success: boolean }>(`/bots/${botId}/triggers/${triggerId}`);
    return data;
  },

  // steps
  async createStep(botId: string, payload: CreateBotStepPayload): Promise<BotStep> {
    const { data } = await apiClient.post<BotStep>(`/bots/${botId}/steps`, payload);
    return data;
  },

  async updateStep(botId: string, stepId: string, payload: UpdateBotStepPayload): Promise<BotStep> {
    const { data } = await apiClient.patch<BotStep>(`/bots/${botId}/steps/${stepId}`, payload);
    return data;
  },

  async removeStep(botId: string, stepId: string): Promise<{ success: boolean }> {
    const { data } = await apiClient.delete<{ success: boolean }>(`/bots/${botId}/steps/${stepId}`);
    return data;
  },

  // sandbox
  async test(id: string, payload: TestBotPayload): Promise<SandboxResult> {
    const { data } = await apiClient.post<SandboxResult>(`/bots/${id}/test`, payload);
    return data;
  },
};