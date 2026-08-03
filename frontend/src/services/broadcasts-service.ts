import { apiClient } from "./api-client";
import type {
  BroadcastSchedule,
  BroadcastProgress,
  CreateBroadcastPayload,
} from "@/types/broadcast";

export const broadcastsService = {
  async list(): Promise<BroadcastSchedule[]> {
    const { data } = await apiClient.get<BroadcastSchedule[]>("/broadcasts");
    return data;
  },

  async create(payload: CreateBroadcastPayload): Promise<BroadcastSchedule> {
    const { data } = await apiClient.post<BroadcastSchedule>("/broadcasts", payload);
    return data;
  },

  async getProgress(id: string): Promise<BroadcastProgress> {
    const { data } = await apiClient.get<BroadcastProgress>(`/broadcasts/${id}/progress`);
    return data;
  },

  async pause(id: string): Promise<BroadcastSchedule> {
    const { data } = await apiClient.patch<BroadcastSchedule>(`/broadcasts/${id}/pause`);
    return data;
  },

  async resume(id: string): Promise<BroadcastSchedule> {
    const { data } = await apiClient.patch<BroadcastSchedule>(`/broadcasts/${id}/resume`);
    return data;
  },
};