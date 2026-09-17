import { Module } from '@nestjs/common';
import type { ApiConfig } from '../config/api-config.schema';
import { APP_CONFIG } from '../config/app-config.module';
import {
  createRedisAppClient,
  REDIS_APP_CLIENT,
  RedisAppConnection,
} from './redis-app-client';

/** Conexión Redis de aplicación (D7 de auth-users). Requiere `AppConfigModule`; exporta `REDIS_APP_CLIENT`. */
@Module({
  providers: [
    {
      provide: REDIS_APP_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: ApiConfig) => createRedisAppClient(config.REDIS_URL),
    },
    RedisAppConnection,
  ],
  exports: [REDIS_APP_CLIENT],
})
export class RedisAppModule {}
