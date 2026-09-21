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
  OutboxQueueErrorLog,
  outboxJobOptionsFor,
  outboxQueueErrorLogToken,
  type QueueErrorSource,
} from './outbox-queues';
import { OUTBOX_QUEUES } from './outbox-routes';
import { MongoOutbox } from './mongo-outbox';
import { OUTBOX_CLOCK, type OutboxClock } from './outbox-clock.port';
import {
  OUTBOX_PUBLISHER,
  type OutboxPublisher,
} from './outbox-publisher.port';
import { OutboxRelay } from './outbox-relay';
import { OutboxModule } from './outbox.module';

/**
 * Relay del outbox (D6 de job-links, ADR-009). Todo lo que necesita —el planificador de `@nestjs/schedule` y las colas
 * de BullMQ— vive dentro de este módulo, porque `AppModule` solo lo importa con `OUTBOX_RELAY_ENABLED=true`: apagado,
 * `api` no crea **ninguna** `Queue` ni abre conexión a Redis por esta vía, y los eventos de los tipos registrados
 * esperan en `outbox_events`.
 *
 * La conexión falla rápido en lugar de encolar comandos (`enableOfflineQueue: false`): con Redis caído, publicar
 * rechaza en el acto y el evento se reintenta con espera creciente, en vez de dejar al relay esperando para siempre.
 * `maxRetriesPerRequest: null` es lo que BullMQ espera de sus conexiones.
 *
 * `analyze-match` se registra con `attempts: 1` (ADR-030 §6): reejecutar el análisis entero multiplicaría los envíos
 * del CV a un proveedor externo. El resto de colas conserva los reintentos de D6.
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
    // Una cola por tipo de evento (D11 de cv-upload-extract): la lista la da la tabla de enrutado, así que añadir un
    // evento nuevo no obliga a acordarse de registrar su cola aquí. Las opciones salen de `outboxJobOptionsFor`.
    ...OUTBOX_QUEUES.map((name) =>
      BullModule.registerQueue({
        name,
        defaultJobOptions: outboxJobOptionsFor(name),
      }),
    ),
  ],
  providers: [
    ...OUTBOX_QUEUES.map((name) => ({
      provide: outboxQueueErrorLogToken(name),
      inject: [getQueueToken(name)],
      useFactory: (queue: QueueErrorSource) =>
        new OutboxQueueErrorLog(name, queue),
    })),
    {
      provide: OUTBOX_PUBLISHER,
      inject: OUTBOX_QUEUES.map((name) => getQueueToken(name)),
      useFactory: (...queues: JobQueue[]) =>
        new BullmqOutboxPublisher(
          new Map(OUTBOX_QUEUES.map((name, index) => [name, queues[index]])),
        ),
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
