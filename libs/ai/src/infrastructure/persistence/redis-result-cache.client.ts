import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { AiLogger } from '../../domain/ports/ai-logger.port';

// Cliente ioredis propio de la caché de IA (D8 de ai-gateway-core), con el patrón del cliente de salud del worker:
// no conecta al crearse, no encola comandos sin conexión y falla una petición tras un reintento. Así un Redis caído
// se traduce en errores inmediatos que `RedisResultCache` trata como fallo de caché.

const BASE_DELAY_MS = 250;
export const AI_CACHE_REDIS_RETRY_MAX_DELAY_MS = 2_000;

/** Backoff exponencial con tope de 2 s. ioredis empieza `times` en 1. */
export function aiCacheRedisRetryDelay(times: number): number {
  return Math.min(
    BASE_DELAY_MS * 2 ** (times - 1),
    AI_CACHE_REDIS_RETRY_MAX_DELAY_MS,
  );
}

/** `enableReadyCheck: false`: el doble RESP de los tests no responde a INFO. */
export function createAiCacheRedisClient(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    retryStrategy: aiCacheRedisRetryDelay,
  });
}

/**
 * Abre la conexión sin bloquear el arranque (`connect()` sin esperar), emite un único aviso por racha de fallos y
 * desconecta al apagar. La registra `AiModule` con una factoría; no expone la URL ni el error completo en el log.
 */
export class AiCacheRedisConnection
  implements OnModuleInit, OnApplicationShutdown
{
  private reportedFailure = false;

  constructor(
    private readonly client: Redis,
    private readonly logger: AiLogger,
  ) {}

  onModuleInit(): void {
    this.client.on('ready', () => {
      this.reportedFailure = false;
    });
    // Sin listener, ioredis escribiría cada reintento por consola.
    this.client.on('error', (error: unknown) => this.reportFailure(error));
    this.client.connect().catch((error: unknown) => this.reportFailure(error));
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }

  private reportFailure(error: unknown): void {
    if (this.reportedFailure) return;
    this.reportedFailure = true;
    this.logger.warn(
      'AI cache Redis client not connected, retrying in background',
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      },
    );
  }
}
