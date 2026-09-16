import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import type { Connection } from 'mongoose';
import { HEALTH_CHECK_TIMEOUT_MS, withTimeout } from './with-timeout';

/**
 * `ping` sobre el cliente del driver que mantiene la conexión de Mongoose. Usa el cliente actual en cada
 * comprobación porque el reintento de la conexión inicial (D8) puede sustituirlo. Cualquier fallo, incluido
 * el timeout, es `down` sin datos adicionales: nunca se propaga el mensaje del driver.
 */
@Injectable()
export class MongoHealthIndicator {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly healthIndicator: HealthIndicatorService,
  ) {}

  async isHealthy<const Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const indicator = this.healthIndicator.check(key);
    try {
      await withTimeout(
        () => this.connection.getClient().db().admin().command({ ping: 1 }),
        HEALTH_CHECK_TIMEOUT_MS,
      );
      return indicator.up();
    } catch {
      return indicator.down();
    }
  }
}
