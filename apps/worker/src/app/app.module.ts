import { type AiConfig, AiModule } from '@linkvault/ai';
import { type DynamicModule, Module } from '@nestjs/common';
import { AppConfigModule } from '../infrastructure/config/app-config.module';
import type { WorkerConfig } from '../infrastructure/config/worker-config.schema';
import { AppLoggerModule } from '../infrastructure/logging/app-logger.module';
import { MongoPersistenceModule } from '../infrastructure/persistence/mongo-persistence.module';
import { BullmqConnectionModule } from '../infrastructure/queue/bullmq-connection.module';
import { RedisHealthModule } from '../infrastructure/redis/redis-health.module';
import { HealthModule } from '../presentation/http/health.module';

@Module({})
export class AppModule {
  /**
   * `ai` es la configuración ya validada por `parseAiConfig` en `loadWorkerConfigOrExit` (D12 de ai-gateway-core).
   * `AiModule` usa la conexión Mongoose por defecto que registra `MongoPersistenceModule`; `redisUrl` se pasa siempre,
   * aunque solo se conecte si la cadena usa la caché real.
   */
  static register(config: WorkerConfig, ai: AiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        AppLoggerModule,
        MongoPersistenceModule,
        RedisHealthModule,
        BullmqConnectionModule,
        AiModule.forRootAsync({
          useFactory: () => ({ config: ai, redisUrl: config.REDIS_URL }),
        }),
        HealthModule,
      ],
    };
  }
}
