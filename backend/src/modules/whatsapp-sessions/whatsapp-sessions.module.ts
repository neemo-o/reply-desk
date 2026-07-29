import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WhatsappSessionsService } from './whatsapp-sessions.service';
import { WhatsappSessionsController } from './whatsapp-sessions.controller';
import { WhatsappSessionsProcessor } from './whatsapp-sessions.processor';
import { ContactFilterService } from './contact-filter.service';
import { ContactsModule } from '../contacts/contacts.module';
import { SESSION_QUEUE } from '../queue/queue.module';

/**
 * 🔒 S24 — Adicionado `ContactFilterService` (lógica whitelist/blacklist)
 * e import de `ContactsModule` (para o `ContactsService.upsertByPhone` que
 * o controller usa no POST /contacts).
 *
 * Exportamos `ContactFilterService` para o WebhooksModule poder usar no
 * inbound MESSAGES_UPSERT.
 */
@Module({
  imports: [BullModule.registerQueue({ name: SESSION_QUEUE }), ContactsModule],
  controllers: [WhatsappSessionsController],
  providers: [WhatsappSessionsService, WhatsappSessionsProcessor, ContactFilterService],
  exports: [WhatsappSessionsService, ContactFilterService],
})
export class WhatsappSessionsModule {}
