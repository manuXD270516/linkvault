import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../config/app-config.module';
import type { WorkerConfig } from '../config/worker-config.schema';

/**
 * Conexión raíz de BullMQ (D8), separada del cliente de salud. `maxRetriesPerRequest: null` es obligatorio para los
 * `Worker` de BullMQ. Sigue sin colas ni `Worker` registrados aquí, y por eso no abre ninguna conexión a Redis por
 * esta vía.
 *
 * El consumidor de `enrich-link` que trajo `link-enrichment` **no pasa por este módulo**: construye su `Worker` en
 * `modules/enrichment` con su propia conexión, porque `concurrency` y `lockDuration` salen de la configuración y las
 * opciones de `@Processor` se fijan al escribir el código. Este módulo queda como la raíz que necesitará la primera
 * cola que el worker publique o consuma con `@nestjs/bullmq`.
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
