import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export const RECURRENCES = ['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY'] as const;
export const MESSAGE_TYPES = ['text', 'list', 'buttons', 'media'] as const;

export class CreateBroadcastDto {
  /// bot de tipo AUTO quedará owner do agendamento (accounting + lookup).
  @IsUUID()
  botId: string;

  @IsUUID()
  contactListId: string;

  /// JSON conteudo: shape variável por `type`. Validado no service via
  /// validateStepContent (reaproveita o mesmo shape dos steps).
  @IsObject()
  mensagem: Record<string, unknown>;

  /// Tipo de mensagem (text|list|buttons|media) — usado para validar shape.
  @IsIn(MESSAGE_TYPES)
  messageType: string;

  @IsISO8601()
  startAt: string;

  @IsOptional()
  @IsIn(RECURRENCES)
  recurrence?: string;
}

export class BroadcastProgressResponse {
  id: string;
  status: string;
  totalContacts: number;
  sent: number;
  pending: number;
  failed: number;
  lastRunAt: string | null;
  updatedAt: string;
}
