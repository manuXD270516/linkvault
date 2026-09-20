import { type AiConfig, AiModule } from '@linkvault/ai';
import { type DynamicModule, Module } from '@nestjs/common';
import { AppConfigModule } from '../infrastructure/config/app-config.module';
import type { WorkerConfig } from '../infrastructure/config/worker-config.schema';
import { AppLoggerModule } from '../infrastructure/logging/app-logger.module';
import { MongoPersistenceModule } from '../infrastructure/persistence/mongo-persistence.module';
import { BullmqConnectionModule } from '../infrastructure/queue/bullmq-connection.module';
import { RedisHealthModule } from '../infrastructure/redis/redis-health.module';
import { CvModule } from '../modules/cv/cv.module';
import { EnrichmentModule } from '../modules/enrichment/enrichment.module';
import { HealthModule } from '../presentation/http/health.module';

@Module({})
export class AppModule {
  /**
   * `ai` es la configuración ya validada por `parseAiConfig` en `loadWorkerConfigOrExit` (D12 de ai-gateway-core).
   * `AiModule` usa la conexión Mongoose por defecto que registra `MongoPersistenceModule`; `redisUrl` se pasa siempre,
   * aunque solo se conecte si la cadena usa la caché real.
   *
   * `EnrichmentModule` recibe la configuración entera porque es quien decide, con ella, si registra el `Worker` de
   * `enrich-link`: en los tests no lo registra, y así la suite no abre ninguna conexión a Redis.
   */
  static register(config: WorkerConfig, ai: AiConfig): DynamicModule {
    // El módulo de IA se construye una sola vez y se le pasa a `EnrichmentModule`: `RUN_TASK` lo exporta `AiModule`, y
    // lo que un módulo importa no llega a sus hermanos. Es el mismo objeto, así que Nest lo instancia una vez.
    const aiModule = AiModule.forRootAsync({
      useFactory: () => ({ config: ai, redisUrl: config.REDIS_URL }),
    });

    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        AppLoggerModule,
        MongoPersistenceModule,
        RedisHealthModule,
        BullmqConnectionModule,
        aiModule,
        EnrichmentModule.register(config, aiModule),
        // `CvModule` recibe la configuración por la misma razón que `EnrichmentModule`: es quien decide, con ella, si
        // registra sus dos `Worker`. En los tests no los registra, y así la suite no abre ninguna conexión a Redis.
        CvModule.register(config),
        HealthModule,
      ],
    };
  }
}
