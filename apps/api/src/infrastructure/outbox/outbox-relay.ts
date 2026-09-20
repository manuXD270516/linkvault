import { Logger, type OnModuleInit } from '@nestjs/common';
import type { MongoOutbox, PendingOutboxEvent } from './mongo-outbox';
import type { OutboxClock } from './outbox-clock.port';
import type { OutboxPublisher } from './outbox-publisher.port';

// Relay del outbox (D6 de job-links, ADR-009): cada vuelta toma los eventos pendientes que ya vencieron, los publica en
// su cola con un `jobId` determinista y los marca. Corre dentro de `api`, que es quien los escribe, y solo existe si
// `OUTBOX_RELAY_ENABLED` está encendido: es `OutboxRelayModule` quien lo registra.

/** Nombre del intervalo en el `SchedulerRegistry` de `@nestjs/schedule`, que lo cancela al apagar la aplicación. */
export const OUTBOX_RELAY_INTERVAL_NAME = 'outbox-relay';

/** Eventos por vuelta. Acotado para que una acumulación no convierta una vuelta en un trabajo largo. */
export const OUTBOX_RELAY_BATCH_SIZE = 50;

/** Tope de la espera entre reintentos: con la cola caída, el relay vuelve a probar cada cinco minutos. */
export const OUTBOX_MAX_RETRY_DELAY_MS = 300_000;

/**
 * Tiempo que un evento puede pasar sin publicarse antes de darlo por perdido. Se mide desde que se escribió, no por
 * número de intentos: así un corte de la cola de minutos u horas no quema los reintentos (ADR-009), que es justo lo que
 * el outbox existe para evitar.
 */
export const OUTBOX_EVENT_MAX_AGE_MS = 86_400_000;

/**
 * Espera antes del siguiente intento: 1 s, 2 s, 4 s… hasta el tope de 5 minutos. `attempts` son los intentos ya
 * gastados antes de este fallo, así que el primero espera un segundo.
 */
export function outboxRetryDelayMs(attempts: number): number {
  return Math.min(2 ** attempts * 1_000, OUTBOX_MAX_RETRY_DELAY_MS);
}

/** Lo que el relay necesita del planificador; `SchedulerRegistry` lo cumple. */
export interface IntervalScheduler {
  addInterval(name: string, intervalId: NodeJS.Timeout): void;
}

/** Lo que el relay necesita de un logger; `Logger` de Nest lo cumple. */
export interface RelayLogWriter {
  warn(message: string): void;
  debug(message: string): void;
}

export class OutboxRelay implements OnModuleInit {
  /** Evita que dos vueltas se solapen si una tarda más que el intervalo. */
  private running = false;

  constructor(
    private readonly outbox: MongoOutbox,
    private readonly publisher: OutboxPublisher,
    private readonly clock: OutboxClock,
    private readonly intervalMs: number,
    private readonly scheduler: IntervalScheduler,
    private readonly writer: RelayLogWriter = new Logger('OutboxRelay'),
  ) {}

  onModuleInit(): void {
    this.scheduler.addInterval(
      OUTBOX_RELAY_INTERVAL_NAME,
      setInterval(() => void this.publishPending(), this.intervalMs),
    );
  }

  /**
   * Una vuelta del relay. Nunca lanza: si Mongo no responde, esta vuelta no hace nada y la siguiente lo intenta otra
   * vez; los eventos siguen pendientes, que es de lo que trata el outbox.
   */
  async publishPending(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const due = await this.outbox.takeDue(
        this.clock.now(),
        OUTBOX_RELAY_BATCH_SIZE,
      );
      for (const event of due) {
        await this.publishOne(event);
      }
    } catch (error) {
      this.writer.debug(`Outbox relay pass failed: ${messageOf(error)}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Publica primero y marca después: si la marca no llega a guardarse, el evento se vuelve a publicar en la vuelta
   * siguiente y el `jobId` determinista impide que la cola tenga dos jobs del mismo evento.
   */
  private async publishOne(event: PendingOutboxEvent): Promise<void> {
    try {
      await this.publisher.publish(event);
    } catch (error) {
      await this.giveItAnotherTry(event, error);
      return;
    }
    await this.outbox.markPublished(event.id, this.clock.now());
  }

  /**
   * Un fallo de publicación no pierde el evento: apunta el intento y lo aplaza con una espera creciente. Solo cuando
   * lleva más de 24 h sin conseguirlo se da por agotado, con un aviso que nombra el evento y nada más: ni la URL, ni el
   * usuario, ni el contenido del payload.
   */
  private async giveItAnotherTry(
    event: PendingOutboxEvent,
    error: unknown,
  ): Promise<void> {
    const now = this.clock.now();
    const attempts = event.attempts + 1;
    if (event.attempts === 0) {
      // **La primera vez que un evento falla, se avisa.** Antes todo el detalle iba a `debug`, y eso escondía durante
      // 24 h los fallos que no son un corte pasajero sino un error nuestro —un `jobId` que la cola rechaza, un tipo
      // que el publicador no conoce, un payload que no cumple su schema—: el trabajo no se hacía, el agregado se
      // quedaba esperando y no se veía **nada**. Aquí llegó a costar un e2e.
      //
      // Es una línea **por evento**, no por vuelta: un corte de Redis avisa una vez de cada evento pendiente y se
      // calla; los reintentos siguientes van a `debug` como siempre. El mensaje del error es el de la cola o el del
      // schema, y el payload del outbox solo lleva identificadores (ADR-009).
      this.writer.warn(
        `Outbox event ${event.id} (${event.type}) could not be published: ${messageOf(error)}`,
      );
    } else {
      this.writer.debug(
        `Outbox event ${event.id} could not be published: ${messageOf(error)}`,
      );
    }
    if (now.getTime() - event.createdAt.getTime() >= OUTBOX_EVENT_MAX_AGE_MS) {
      await this.outbox.markFailed(event.id, attempts, now);
      this.writer.warn(
        `Outbox event ${event.id} (${event.type}) given up after ${attempts} attempts and more than 24h pending`,
      );
      return;
    }
    const nextAttemptAt = new Date(
      now.getTime() + outboxRetryDelayMs(event.attempts),
    );
    await this.outbox.scheduleRetry(event.id, attempts, nextAttemptAt);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
