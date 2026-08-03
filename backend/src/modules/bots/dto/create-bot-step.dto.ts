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

export const STEP_MESSAGE_TYPES = ['text', 'list', 'buttons', 'media'] as const;

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
