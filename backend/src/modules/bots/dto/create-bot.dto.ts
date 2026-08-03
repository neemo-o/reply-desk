import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const BOT_TYPES = ['CONVENTIONAL', 'BROADCAST'] as const;
export const BOT_STATUSES = ['draft', 'active', 'inactive'] as const;

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
}
