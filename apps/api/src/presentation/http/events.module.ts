import { Module } from '@nestjs/common';
import { RealtimeModule } from '../../infrastructure/realtime/realtime.module';
import { EventsController } from './events.controller';

/** Canal de eventos servidor→cliente (spec platform/realtime). El registro de conexiones vive en `RealtimeModule`. */
@Module({
  imports: [RealtimeModule],
  controllers: [EventsController],
})
export class EventsModule {}
