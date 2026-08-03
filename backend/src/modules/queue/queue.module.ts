import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';

export const SESSION_QUEUE = 'whatsapp-sessions';
export const MESSAGE_QUEUE = 'messages';
/// 🤖 Fila exclusiva do bot conversacional — respostas no inbound webhook.
/// Concorrência alta para não atrasar atendimento humano.
export const BOT_MESSAGE_QUEUE = 'bot-messages';
/// 📣 Fila de broadcast — disparo em massa. Concorrência 1 + delay grande.
/// Separada da fila do bot para garantir que disparo lento não atrase o bot.
export const BROADCAST_QUEUE = 'broadcast-messages';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: SESSION_QUEUE },
      { name: MESSAGE_QUEUE },
      { name: BOT_MESSAGE_QUEUE },
      { name: BROADCAST_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
