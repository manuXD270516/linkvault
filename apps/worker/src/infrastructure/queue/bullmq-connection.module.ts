import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/app-config.module';
import type { WorkerConfig } from '../config/worker-config.schema';

/**
 * Conexión raíz de BullMQ (D8), separada del cliente de salud. `maxRetriesPerRequest: null` es obligatorio
 * para los `Worker` de BullMQ. Sigue sin colas ni `Worker` registrados, y por eso no abre ninguna conexión a Redis por
 * esta vía: `job-links` ya publica jobs en `enrich-link`, pero desde el relay del outbox de `api` y a propósito sin
 * consumidor (D7 de job-links). Los jobs esperan en la cola —y sus links, en `pending`— hasta que `link-enrichment`
 * registre aquí el primer `Worker`; un consumidor provisional los descartaría, que es lo que el outbox evita.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: WorkerConfig) => ({
        connection: { url: config.REDIS_URL, maxRetriesPerRequest: null },
      }),
    }),
  ],
})
export class BullmqConnectionModule {}
