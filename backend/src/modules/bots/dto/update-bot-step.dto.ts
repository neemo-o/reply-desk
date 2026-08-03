import { PartialType } from '@nestjs/mapped-types';
import { CreateBotStepDto } from './create-bot-step.dto';

export class UpdateBotStepDto extends PartialType(CreateBotStepDto) {}
