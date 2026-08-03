import { PartialType } from '@nestjs/mapped-types';
import { CreateBotTriggerDto } from './create-bot-trigger.dto';

export class UpdateBotTriggerDto extends PartialType(CreateBotTriggerDto) {}
