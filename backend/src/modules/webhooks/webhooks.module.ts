import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { EvolutionWebhooksService } from './evolution-webhooks.service';
import { EvolutionWebhookController } from './evolution-webhook.controller';
import { WhatsappSessionsModule } from '../whatsapp-sessions/whatsapp-sessions.module';

@Module({
  imports: [WhatsappSessionsModule], // 🔒 EvolutionWebhookController precisa de WhatsappSessionsService
  controllers: [WebhooksController, EvolutionWebhookController],
  providers: [WebhooksService, EvolutionWebhooksService],
})
export class WebhooksModule {}
