import { Module } from '@nestjs/common';
import type { WorkerConfig } from '../config/worker-config.schema';
import { APP_CONFIG } from '../config/app-config.module';
import {
  createRedisHealthClient,
  REDIS_HEALTH_CLIENT,
  RedisHealthConnection,
} from './redis-health-client';

@Module({
  providers: [
    {
      provide: REDIS_HEALTH_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: WorkerConfig) =>
        createRedisHealthClient(config.REDIS_URL),
    },
    RedisHealthConnection,
  ],
  exports: [REDIS_HEALTH_CLIENT],
})
export class RedisHealthModule {}
