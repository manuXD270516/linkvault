import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/app-config.module';
import type { WorkerConfig } from '../config/worker-config.schema';

/**
 * Conexión raíz de BullMQ (D8), separada del cliente de salud. `maxRetriesPerRequest: null` es obligatorio
 * para los `Worker` de BullMQ. Sin colas ni `Worker` registrados: el primer job llega con `job-links`, y
 * hasta entonces no se abre ninguna conexión a Redis por esta vía.
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
