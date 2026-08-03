import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BroadcastsService } from './broadcasts.service';
import { BroadcastsController } from './broadcasts.controller';
import { BroadcastProcessor } from './broadcasts.processor';
import { BROADCAST_QUEUE } from '../queue/queue.module';

@Module({
  imports: [BullModule.registerQueue({ name: BROADCAST_QUEUE })],
  controllers: [BroadcastsController],
  providers: [BroadcastsService, BroadcastProcessor],
  exports: [BroadcastsService],
})
export class BroadcastModule {}
