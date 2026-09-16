import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  type ConnectOptions,
  ConnectionStates,
  type Connection,
} from 'mongoose';

const BASE_DELAY_MS = 250;
export const MONGO_RETRY_MAX_DELAY_MS = 2_000;

/** Backoff exponencial con tope de 2 s (D8). `attempt` empieza en 0. */
export function mongoRetryDelay(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MONGO_RETRY_MAX_DELAY_MS);
}

/**
 * Con `lazyConnection` Mongoose no bloquea el arranque, pero si la conexión inicial falla no la reintenta.
 * Este servicio reintenta `openUri` con backoff ante un `error` previo al primer `connected` (D8). Tras la
 * primera conexión, la reconexión es cosa del driver. Registrar el listener de `error` además evita que el
 * rechazo de la conexión inicial quede sin manejar.
 */
@Injectable()
export class MongoInitialConnectRetry implements BeforeApplicationShutdown {
  private readonly logger = new Logger(MongoInitialConnectRetry.name);
  private readonly connections = new Set<Connection>();
  private timer: NodeJS.Timeout | undefined;
  private stopped = false;

  /** `options` son las mismas que recibió `forRootAsync`; cada reintento las reenvía. */
  attach(
    connection: Connection,
    uri: string,
    options: Readonly<ConnectOptions>,
  ): Connection {
    let attempt = 0;
    let connected = false;
    this.connections.add(connection);

    connection.on('connected', () => {
      connected = true;
    });
    connection.on('error', (error: unknown) => {
      if (connected || this.stopped) {
        return;
      }
      const delay = mongoRetryDelay(attempt);
      attempt += 1;
      // Solo el nombre del error: el mensaje del driver puede incluir hosts o detalles de la URI.
      this.logger.warn(
        `Initial MongoDB connection failed (${errorName(error)}), retry ${attempt} in ${delay} ms`,
      );
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (this.stopped) {
          return;
        }
        // Un nuevo fallo vuelve a emitir `error` y reprograma el reintento.
        // Copia: Mongoose puede mutar el objeto de opciones que recibe.
        connection.openUri(uri, { ...options }).catch(() => undefined);
      }, delay);
      this.timer.unref();
    });

    return connection;
  }

  /**
   * Corre antes de que `MongooseModule` cierre la conexión. Mientras la conexión inicial está pendiente,
   * `Connection.close()` espera a que termine la selección de servidor (30 s por defecto); cerrar el cliente
   * del driver la aborta y el apagado no se bloquea.
   */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await Promise.all(
      [...this.connections]
        .filter((c) => c.readyState === ConnectionStates.connecting)
        .map((c) =>
          c
            .getClient()
            .close(true)
            .catch(() => undefined),
        ),
    );
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}
