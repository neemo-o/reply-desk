import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { EvolutionWebhooksService } from './evolution-webhooks.service';
import { EvolutionWebhookController } from './evolution-webhook.controller';
import { WebhookMetricsService } from './webhook-metrics.service';
import { WhatsappSessionsModule } from '../whatsapp-sessions/whatsapp-sessions.module';
import { BotsModule } from '../bots/bots.module';

@Module({
  imports: [WhatsappSessionsModule, BotsModule], // 🔒 EvolutionWebhookController precisa de WhatsappSessionsService; 🤖 BotEngine para inbound
  controllers: [WebhooksController, EvolutionWebhookController],
  providers: [WebhooksService, EvolutionWebhooksService, WebhookMetricsService],
})
export class WebhooksModule {}
