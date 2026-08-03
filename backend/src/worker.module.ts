import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { LoggerModule } from './common/logger/logger.module';
import { EvolutionModule } from './common/evolution/evolution.module';
import { QueueModule } from './modules/queue/queue.module';
import { WhatsappSessionsModule } from './modules/whatsapp-sessions/whatsapp-sessions.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { BroadcastModule } from './modules/broadcast/broadcast.module';
import { RealtimeModule } from './modules/realtime/realtime.module';

/**
 * 📈 E1 — WorkerModule: contexto NestJS para o processo worker.
 *
 * Importa apenas módulos necessários para consumir filas:
 * - QueueModule (BullMQ setup + queues)
 * - WhatsappSessionsModule (SessionProcessor)
 * - ConversationsModule (ConversationsService (para MessageProcessor)
 *
 * SubscriptionsModule é necessário porque ConversationsController (registrado
 * em ConversationsModule) usa @UseGuards(SubscriptionGuard), que injeta
 * SubscriptionsService. Sem este import, o DI do Nest falha no boot do worker.
 * SubscriptionsModule é @Global() na AppModule, mas no WorkerModule precisa
 * ser importado explicitamente porque é um contexto de aplicação separado.
 *
 * NOTA: controllers NÃO servem HTTP no worker, mas ainda são instanciados
 * pelo DI do Nest, então suas dependências devem ser resolvíveis.
 * NOTA: throttler/JWT/CORS não são necessários aqui.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate }),
    ScheduleModule.forRoot(),
    LoggerModule,
    PrismaModule,
    RedisModule,
    EvolutionModule,
    QueueModule,
    SubscriptionsModule,   // resolve SubscriptionGuard → SubscriptionsService
    WhatsappSessionsModule, // contém WhatsappSessionsProcessor
    ConversationsModule,    // contém ConversationsService (para MessageProcessor)
    BroadcastModule,        // contém BroadcastProcessor
    RealtimeModule,         // RealtimeService (injetado pelo BroadcastProcessor)
  ],
})
export class WorkerModule {}
