import {
  Inject,
  Injectable,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { redisRetryDelay } from './redis-health-client';

/** Token del cliente ioredis de aplicación (límites de intentos de `auth`). No es el de salud ni el de BullMQ. */
export const REDIS_APP_CLIENT = Symbol('REDIS_APP_CLIENT');

/** Un comando que tarda más falla: con el límite de intentos, la petición sigue sin límite (fail-open, D7). */
export const REDIS_APP_COMMAND_TIMEOUT_MS = 200;

/**
 * Cliente de aplicación (D7 de auth-users): no conecta al crearse, no encola comandos sin conexión y cada comando expira
 * a los 200 ms. `enableReadyCheck: false`: el doble RESP de los tests no responde a INFO.
 */
export function createRedisAppClient(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    commandTimeout: REDIS_APP_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    retryStrategy: redisRetryDelay,
  });
}

/**
 * Abre la conexión sin bloquear el arranque y la cierra al apagar. No registra los fallos de conexión: los avisa, uno por
 * racha, quien usa el cliente (`RedisAttemptLimiter`), para que un Redis caído no produzca dos avisos.
 */
@Injectable()
export class RedisAppConnection implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(REDIS_APP_CLIENT) private readonly client: Redis) {}

  onModuleInit(): void {
    // Sin listener, ioredis escribiría cada reintento por consola.
    this.client.on('error', () => undefined);
    this.client.connect().catch(() => undefined);
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
