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
  static register(config: WorkerConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        AppLoggerModule,
        MongoPersistenceModule,
        RedisHealthModule,
        BullmqConnectionModule,
        HealthModule,
      ],
    };
  }
}
