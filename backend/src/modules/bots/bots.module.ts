import { forwardRef, Module } from '@nestjs/common';
import { BotsService } from './bots.service';
import { BotsController } from './bots.controller';
import { BotEngineModule } from './engine/bot-engine.module';
import { InstanceController } from './instance.controller';
import { InstanceStatusService } from './instance-status.service';
import { SandboxBotService } from './sandbox-bot.service';
import { WhatsappSessionsModule } from '../whatsapp-sessions/whatsapp-sessions.module';
import { BroadcastModule } from '../broadcast/broadcast.module';

/**
 * 🔒 Bug 4 — Importa WhatsappSessionsModule via forwardRef porque o
 * BotsService injeta WhatsappSessionsService (cascadeDisconnectSessions).
 * 🤖 S24 — Importa BroadcastModule via forwardRef porque o BotsService injeta
 * BroadcastsService (pauseByBot ao inativar bot de campanha AUTO). O
 * BroadcastModule também importa BotsModule (auto-ativar bot ao agendar),
 * então o ciclo é resolvido nos dois lados com forwardRef.
 */
@Module({
  imports: [
    BotEngineModule,
    forwardRef(() => WhatsappSessionsModule),
    forwardRef(() => BroadcastModule),
  ],
  controllers: [BotsController, InstanceController],
  providers: [BotsService, InstanceStatusService, SandboxBotService],
  exports: [BotsService, BotEngineModule, InstanceStatusService],
})
export class BotsModule {}
