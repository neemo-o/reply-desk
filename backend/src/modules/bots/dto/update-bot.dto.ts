import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { BOT_STATUSES, BOT_TYPES } from './create-bot.dto';

/**
 * 🤖 UpdateBotDto — todos os campos opcionais (PATCH parcial).
 *
 * Campos nullable (`testContactPhone`, `offlineMessage`): enviar `null` remove.
 */
export class UpdateBotDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(BOT_TYPES)
  type?: string;

  @IsOptional()
  @IsIn(BOT_STATUSES)
  status?: string;

  /// Atualiza contato de teste. `null` = remove.
  @IsOptional()
  @Matches(/^\d{6,15}$/, {
    message: 'testContactPhone deve ser E.164 só dígitos (sem +)',
    each: false,
  })
  testContactPhone?: string | null;

  /// Atualiza a mensagem de fora de horário. `null` = desativa.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  offlineMessage?: string | null;
}
