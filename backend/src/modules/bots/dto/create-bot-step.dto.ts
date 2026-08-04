import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/// Tipos de mensagem suportados em um bot step.
/// text|list|buttons|media — conteúdo normal enviado ao contato.
/// handoff — transfere a conversa para atendimento humano (não envia mensagem
///           ao contato via Evolution; apenas atualiza Conversation.assignedUser
///           e marca BotSession como 'routed'). `conteudo.actionConfig` define
///           queue/departamento opcional (reservado p/ roteamento futuro).
export const STEP_MESSAGE_TYPES = ['text', 'list', 'buttons', 'media', 'handoff'] as const;

export class StepConditionDto {
  @IsString()
  match: string;

  @IsInt()
  @Min(1)
  stepOrder: number;
}

export class CreateBotStepDto {
  @IsInt()
  @Min(1)
  @Max(999)
  ordem: number;

  @IsIn(STEP_MESSAGE_TYPES)
  tipoMensagem: string;

  @IsObject()
  conteudo: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => StepConditionDto)
  condicoesProximo?: StepConditionDto[];

  @IsOptional()
  @IsInt()
  @Min(1)
  fallbackStepOrder?: number;
}
