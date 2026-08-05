import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 🔒 Bug 2 — Horários de atendimento da organização.
 *
 * Dia da semana: 0 (domingo) a 6 (sábado).
 * Hora no formato "HH:mm" LOCAL do timezone do tenant.
 *
 * Janelas que cruzam meia-noite são suportadas (ex: open=23:00 close=02:00).
 */
export class BusinessHoursDayDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsString()
  @MaxLength(5)
  open: string;

  @IsString()
  @MaxLength(5)
  close: string;
}

export class BusinessHoursDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BusinessHoursDayDto)
  days: BusinessHoursDayDto[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

/**
 * 🔒 Bug 2 — DTO de atualização do tenant expandido p/ offline/welcome/horários.
 * Mantém os campos antigos opcionais (PATCH parcial) — o que não é enviado
 * não é alterado.
 */
export class UpdateTenantSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  logo?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  language?: string;

  /// NULL = sem horário definido (atendimento 24/7).
  @IsOptional()
  @ValidateNested()
  @Type(() => BusinessHoursDto)
  businessHours?: BusinessHoursDto | null;

  /// NULL = não responde fora do horário (mesmo que businessHours definido).
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  offlineMessage?: string | null;

  /// NULL = não envia mensagem de boas-vindas.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  welcomeMessage?: string | null;
}

/// Helper: valida que value é string no formato "HH:mm".
export function isValidHourMinute(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * Valida um DTO BusinessHoursDto. Retorna array de mensagens legíveis (vazio se válido).
 */
export function validateBusinessHoursDto(dto: BusinessHoursDto): string[] {
  const errors: string[] = [];
  if (!Array.isArray(dto.days)) {
    errors.push('businessHours.days deve ser uma lista');
    return errors;
  }
  if (dto.days.length === 0) {
    errors.push('businessHours.days não pode ser vazio');
    return errors;
  }
  for (const d of dto.days) {
    if (typeof d.dayOfWeek !== 'number' || d.dayOfWeek < 0 || d.dayOfWeek > 6) {
      errors.push(`dayOfWeek inválido (0-6): ${d.dayOfWeek}`);
    }
    if (!isValidHourMinute(d.open)) errors.push(`open "${d.open}" inválido (use HH:mm)`);
    if (!isValidHourMinute(d.close)) errors.push(`close "${d.close}" inválido (use HH:mm)`);
  }
  return errors;
}
