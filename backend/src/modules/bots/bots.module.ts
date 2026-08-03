import { Module } from '@nestjs/common';
import { BotsService } from './bots.service';
import { BotsController } from './bots.controller';
import { BotEngineModule } from './engine/bot-engine.module';
import { InstanceController } from './instance.controller';
import { InstanceStatusService } from './instance-status.service';
import { SandboxBotService } from './sandbox-bot.service';

@Module({
  imports: [BotEngineModule],
  controllers: [BotsController, InstanceController],
  providers: [BotsService, InstanceStatusService, SandboxBotService],
  exports: [BotsService, BotEngineModule, InstanceStatusService],
})
export class BotsModule {}
