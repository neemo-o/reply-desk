import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/// Tipos de bot disponíveis. Cada um define um editor + comportamento distintos.
///   SIMPLE  — bot comum: responde UMA mensagem (boas-vindas) por contato.
///   AGENTS  — bot de agentes: fluxo multi-step com handoff humano.
///   AUTO    — bot de auto-mensagem: dispara 1 mensagem agendada (recorrente ou não).
export const BOT_TYPES = ['SIMPLE', 'AGENTS', 'AUTO'] as const;
export type BotType = (typeof BOT_TYPES)[number];

/// Status do bot. `testing` só interage com `testContactPhone`.
export const BOT_STATUSES = ['draft', 'testing', 'active', 'inactive'] as const;
export type BotStatus = (typeof BOT_STATUSES)[number];

export class CreateBotDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsIn(BOT_TYPES)
  type: string;

  /// Quando informado, o bot nasce em `testing` e só responde a este telefone.
  /// E.164 sem "+", ex: 5511999998888.
  @IsOptional()
  @IsString()
  @Matches(/^\d{6,15}$/, { message: 'testContactPhone deve ser E.164 só dígitos (sem +)' })
  testContactPhone?: string;

  /// Mensagem enviada fora do horário de atendimento do tenant. NULL = ignorar.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  offlineMessage?: string;
}
