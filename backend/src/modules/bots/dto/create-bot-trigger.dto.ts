import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const TRIGGER_TYPES = ['keyword', 'first_message'] as const;

export class CreateBotTriggerDto {
  @IsIn(TRIGGER_TYPES)
  tipo: string;

  /// valor: palavra-chave (quando tipo='keyword'). Em 'first_message' é ignorado.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  valor?: string;
}
