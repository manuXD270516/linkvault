import { ENRICH_LINK_QUEUE } from '@linkvault/shared';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import type { ApiConfig } from '../config/api-config.schema';
import { APP_CONFIG } from '../config/app-config.module';
import {
  BullmqOutboxPublisher,
  type JobQueue,
} from './bullmq-outbox-publisher';
import {
  ENRICH_LINK_JOB_OPTIONS,
  EnrichLinkQueueErrorLog,
  type QueueErrorSource,
} from './enrich-link-queue';
import { MongoOutbox } from './mongo-outbox';
import { OUTBOX_CLOCK, type OutboxClock } from './outbox-clock.port';
import {
  OUTBOX_PUBLISHER,
  type OutboxPublisher,
} from './outbox-publisher.port';
import { OutboxRelay } from './outbox-relay';
import { OutboxModule } from './outbox.module';

/**
 * Relay del outbox (D6 de job-links, ADR-009). Todo lo que necesita —el planificador de `@nestjs/schedule` y la cola de
 * BullMQ— vive dentro de este módulo, porque `AppModule` solo lo importa con `OUTBOX_RELAY_ENABLED=true`: apagado,
 * `api` no crea ninguna `Queue` ni abre conexión a Redis por esta vía y los eventos esperan en `outbox_events`.
 *
 * La conexión falla rápido en lugar de encolar comandos (`enableOfflineQueue: false`): con Redis caído, publicar
 * rechaza en el acto y el evento se reintenta con espera creciente, en vez de dejar al relay esperando para siempre.
 * `maxRetriesPerRequest: null` es lo que BullMQ espera de sus conexiones.
 */
@Module({
  imports: [
    OutboxModule,
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: ApiConfig) => ({
        connection: {
          url: config.REDIS_URL,
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
        },
      }),
    }),
    BullModule.registerQueue({
      name: ENRICH_LINK_QUEUE,
      defaultJobOptions: ENRICH_LINK_JOB_OPTIONS,
    }),
  ],
  providers: [
    {
      provide: EnrichLinkQueueErrorLog,
      inject: [getQueueToken(ENRICH_LINK_QUEUE)],
      useFactory: (queue: QueueErrorSource) =>
        new EnrichLinkQueueErrorLog(queue),
    },
    {
      provide: OUTBOX_PUBLISHER,
      inject: [getQueueToken(ENRICH_LINK_QUEUE)],
      useFactory: (queue: JobQueue) => new BullmqOutboxPublisher(queue),
    },
    {
      provide: OutboxRelay,
      inject: [
        MongoOutbox,
        OUTBOX_PUBLISHER,
        OUTBOX_CLOCK,
        APP_CONFIG,
        SchedulerRegistry,
      ],
      useFactory: (
        outbox: MongoOutbox,
        publisher: OutboxPublisher,
        clock: OutboxClock,
        config: ApiConfig,
        scheduler: SchedulerRegistry,
      ) =>
        new OutboxRelay(
          outbox,
          publisher,
          clock,
          config.OUTBOX_RELAY_INTERVAL_MS,
          scheduler,
        ),
    },
  ],
})
export class OutboxRelayModule {}
