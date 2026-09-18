import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';

// Cliente de Redis del enriquecimiento: la caché del `robots.txt` y el mutex por host (D6). Es propio y no el de la
// salud ni el de BullMQ, porque su vida y sus reintentos son otros: aquí un comando que no llega solo retrasa una
// descarga, mientras que una conexión de BullMQ que reintenta para siempre es lo que mantiene vivo al consumidor.

export const ENRICHMENT_REDIS = Symbol('ENRICHMENT_REDIS');

/** No conecta al crearse y no encola comandos sin conexión: sin Redis, un comando falla en el acto. */
export function createEnrichmentRedisClient(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
  });
}

/** Abre la conexión sin bloquear el arranque y la cierra al apagar la aplicación. */
@Injectable()
export class EnrichmentRedisConnection
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(EnrichmentRedisConnection.name);
  private reported = false;

  constructor(@Inject(ENRICHMENT_REDIS) private readonly client: Redis) {}

  onModuleInit(): void {
    this.client.on('ready', () => {
      this.reported = false;
    });
    // Un error por racha: sin oyente, ioredis escribiría cada reintento por consola y Node tumbaría el proceso.
    this.client.on('error', (error: unknown) => this.report(error));
    this.client.connect().catch((error: unknown) => this.report(error));
  }

  onApplicationShutdown(): void {
    this.client.disconnect();
  }

  private report(error: unknown): void {
    if (this.reported) return;
    this.reported = true;
    this.logger.warn(
      `enrichment redis unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
