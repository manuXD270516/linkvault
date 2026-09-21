import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';

// Cliente Redis del módulo `match`: publica `analysis.step` (cv-suggestions-review). Propio del módulo; no es el de
// BullMQ ni el de salud. Sin Redis, un comando falla en el acto y el aviso se descarta sin tumbar el análisis.

export const MATCH_REDIS = Symbol('MATCH_REDIS');

/** No conecta al crearse y no encola comandos sin conexión: sin Redis, un comando falla en el acto. */
export function createMatchRedisClient(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
  });
}

/** Abre la conexión sin bloquear el arranque y la cierra al apagar la aplicación. */
@Injectable()
export class MatchRedisConnection
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(MatchRedisConnection.name);
  private reported = false;

  constructor(@Inject(MATCH_REDIS) private readonly client: Redis) {}

  onModuleInit(): void {
    this.client.on('ready', () => {
      this.reported = false;
    });
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
      `match redis unavailable: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
