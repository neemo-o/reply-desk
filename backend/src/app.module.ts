import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import configuration from './config/configuration';
import { validate } from './config/env.validation';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { MailModule } from './common/mail/mail.module';
import { LoggerModule } from './common/logger/logger.module';
import { EvolutionModule } from './common/evolution/evolution.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TenantGuard } from './common/guards/tenant.guard';
import { SubscriptionGuard } from './common/guards/subscription.guard';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { QueueModule } from './modules/queue/queue.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { WhatsappSessionsModule } from './modules/whatsapp-sessions/whatsapp-sessions.module';
import { BotsModule } from './modules/bots/bots.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { HealthModule } from './modules/health/health.module';

/**
 * 📈 E1/E9 — AppModule: processo HTTP apenas.
 *
 * WhatsappSessionsProcessor e MessageProcessor ficam registrados dentro
 * de seus módulos, mas o WorkerHost só é ATIVADO no processo worker
 * (worker.ts → WorkerModule). Aqui na API, os processors existem como
 * providers mas não consomem a fila — BullMQ detecta automaticamente
 * qual processo deve ativar o worker.
 *
 * Se preferir isolar completamente: remover os processors dos providers
 * aqui e importar apenas em WorkerModule. Por simplicidade no MVP,
 * mantemos ambos registrados — BullMQ ignora o consumer na API.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate }),
    
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 40 },
      { name: 'global', ttl: 60_000, limit: 100 },
    ]),
    ScheduleModule.forRoot(),
    LoggerModule,
    PrismaModule,
    RedisModule,
    MailModule,
    EvolutionModule,
    QueueModule,
    AuthModule,
    UsersModule,
    TenantsModule,
    SubscriptionsModule,
    WhatsappSessionsModule,
    BotsModule,
    ContactsModule,
    ConversationsModule,
    WebhooksModule,
    HealthModule, // 📈 E4 — healthcheck
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: TenantGuard }, // 🔒 populata request.tenantId antes do SubscriptionGuard
    { provide: APP_GUARD, useClass: SubscriptionGuard }, // 🔒 M6 — global
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
