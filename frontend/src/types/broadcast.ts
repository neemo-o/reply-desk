/**
 * Tipos de Broadcast — fonte canônica está em `@/types/bots`.
 *
 * Este arquivo reexporta os tipos compartilhados para manter o caminho
 * `@/types/broadcast` usado por hooks/services já existentes, evitando
 * duplicação entre `bots.ts` e `broadcast.ts`.
 */
export type {
  BroadcastRecurrence,
  BroadcastSchedule,
  CreateBroadcastPayload,
} from "@/types/bots";

import type { BroadcastSchedule } from "@/types/bots";

export interface BroadcastProgress {
  id: string;
  status: BroadcastSchedule["status"];
  totalContacts: number;
  sent: number;
  pending: number;
  failed: number;
  lastRunAt: string | null;
  updatedAt: string;
}
