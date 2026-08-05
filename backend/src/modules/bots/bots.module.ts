import { forwardRef, Module } from '@nestjs/common';
import { BotsService } from './bots.service';
import { BotsController } from './bots.controller';
import { BotEngineModule } from './engine/bot-engine.module';
import { InstanceController } from './instance.controller';
import { InstanceStatusService } from './instance-status.service';
import { SandboxBotService } from './sandbox-bot.service';
import { WhatsappSessionsModule } from '../whatsapp-sessions/whatsapp-sessions.module';

/**
 * 🔒 Bug 4 — Importa WhatsappSessionsModule via forwardRef porque o
 * BotsService injeta WhatsappSessionsService (cascadeDisconnectSessions).
 */
@Module({
  imports: [BotEngineModule, forwardRef(() => WhatsappSessionsModule)],
  controllers: [BotsController, InstanceController],
  providers: [BotsService, InstanceStatusService, SandboxBotService],
  exports: [BotsService, BotEngineModule, InstanceStatusService],
})
export class BotsModule {}
