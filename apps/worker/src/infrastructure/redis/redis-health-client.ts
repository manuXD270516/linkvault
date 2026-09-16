import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';

/** Token del cliente de ioredis dedicado a la salud. No es la conexión de BullMQ. */
export const REDIS_HEALTH_CLIENT = Symbol('REDIS_HEALTH_CLIENT');

const BASE_DELAY_MS = 250;
export const REDIS_RETRY_MAX_DELAY_MS = 2_000;

/** Backoff exponencial con tope de 2 s. ioredis empieza `times` en 1. */
export function redisRetryDelay(times: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** (times - 1), REDIS_RETRY_MAX_DELAY_MS);
}

/**
 * Cliente de salud (D8): no conecta al crearse, no encola comandos sin conexión y falla una petición tras
 * un reintento. `enableReadyCheck: false` porque la salud solo necesita PING (el doble RESP de los tests
 * no responde a INFO).
 */
export function createRedisHealthClient(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    retryStrategy: redisRetryDelay,
  });
}

/** Abre la conexión sin bloquear el arranque y la cierra al apagar la aplicación. */
@Injectable()
export class RedisHealthConnection
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(RedisHealthConnection.name);
  private reportedFailure = false;

  constructor(@Inject(REDIS_HEALTH_CLIENT) private readonly client: Redis) {}

  onModuleInit(): void {
    this.client.on('ready', () => {
      this.reportedFailure = false;
    });
    // Un error por racha de fallos; sin listener, ioredis escribiría cada reintento por consola.
    this.client.on('error', (error: unknown) => this.reportFailure(error));
    this.client.connect().catch((error: unknown) => this.reportFailure(error));
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }

  private reportFailure(error: unknown): void {
    if (this.reportedFailure) {
      return;
    }
    this.reportedFailure = true;
    const name = error instanceof Error ? error.name : 'UnknownError';
    this.logger.warn(
      `Redis health client not connected (${name}), retrying in background`,
    );
  }
}
