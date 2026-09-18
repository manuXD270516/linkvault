import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_APP_CLIENT } from '../redis/redis-app-client';
import { RedisAppModule } from '../redis/redis-app.module';
import { FIXED_WINDOW_COUNTER } from './fixed-window-counter';
import { RedisFixedWindowCounter } from './redis-fixed-window-counter';

/**
 * Contador de intentos por ventana fija, compartido por los módulos que limitan algo (D13 de link-enrichment). Es
 * plataforma, como el outbox: `auth` y `links` lo consumen cada uno por su propio token, así que ninguno importa al
 * otro y la regla de módulos de ADR-020 §6 se respeta.
 */
@Module({
  imports: [RedisAppModule],
  providers: [
    {
      provide: FIXED_WINDOW_COUNTER,
      inject: [REDIS_APP_CLIENT],
      useFactory: (client: Redis) => new RedisFixedWindowCounter(client),
    },
  ],
  exports: [FIXED_WINDOW_COUNTER],
})
export class LimitsModule {}
