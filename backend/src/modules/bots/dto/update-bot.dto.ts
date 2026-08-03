import { IsIn, IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { BOT_STATUSES, CreateBotDto } from './create-bot.dto';

export class UpdateBotDto extends PartialType(CreateBotDto) {
  @IsOptional()
  @IsIn(BOT_STATUSES)
  status?: string;
}