import { Module } from '@nestjs/common';
import type { ApiConfig } from '../config/api-config.schema';
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
      useFactory: (config: ApiConfig) =>
        createRedisHealthClient(config.REDIS_URL),
    },
    RedisHealthConnection,
  ],
  exports: [REDIS_HEALTH_CLIENT],
})
export class RedisHealthModule {}
