import { IsArray, IsOptional, IsString } from 'class-validator';

export class TestBotDto {
  /// mensagem inicial do usuário (texto)
  @IsOptional()
  @IsString()
  startMessage?: string;

  /// Lista de respostas subsequentes do usuário (em ordem).
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  userMessages?: string[];
}
