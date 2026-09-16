import { Inject, Injectable } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import type { Redis } from 'ioredis';
import { REDIS_HEALTH_CLIENT } from '../redis/redis-health-client';
import { HEALTH_CHECK_TIMEOUT_MS, withTimeout } from './with-timeout';

/**
 * `PING` sobre el cliente de salud (D8). Sin cola offline, un Redis caído falla al instante; uno colgado se
 * corta a los 500 ms. Cualquier fallo es `down` sin datos adicionales.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_HEALTH_CLIENT) private readonly client: Redis,
    private readonly healthIndicator: HealthIndicatorService,
  ) {}

  async isHealthy<const Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const indicator = this.healthIndicator.check(key);
    try {
      const reply = await withTimeout(
        () => this.client.ping(),
        HEALTH_CHECK_TIMEOUT_MS,
      );
      return reply === 'PONG' ? indicator.up() : indicator.down();
    } catch {
      return indicator.down();
    }
  }
}
