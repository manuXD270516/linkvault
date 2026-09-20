import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types, type ClientSession, type Connection, type Model } from 'mongoose';
import type {
  Outbox,
  OutboxEvent,
} from './outbox.port';
import type { TransactionSession } from './transaction-session';
import { OUTBOX_CLOCK, type OutboxClock } from './outbox-clock.port';
import {
  OUTBOX_EVENT_MODEL_NAME,
  outboxEventSchema,
  type OutboxEventDocument,
} from './outbox-event.schemas';

// Adaptador Mongo del puerto OUTBOX (D6 de job-links, ADR-009) sobre la conexión Mongoose de la app
// (`getConnectionToken()`). El caso de uso solo escribe con `append`, dentro de su transacción y sin tocar la cola; el
// resto de operaciones son del relay, que vive en esta misma carpeta de plataforma.

/** Evento pendiente tal y como lo ve el relay: sin estado de Mongo, solo lo que necesita para publicarlo. */
export interface PendingOutboxEvent {
  readonly id: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
  /** Intentos de publicación ya gastados; el primero es 0. */
  readonly attempts: number;
  readonly createdAt: Date;
}

@Injectable()
export class MongoOutbox implements Outbox {
  private readonly events: Model<OutboxEventDocument>;

  constructor(
    @Inject(getConnectionToken()) connection: Connection,
    @Inject(OUTBOX_CLOCK) private readonly clock: OutboxClock,
  ) {
    this.events =
      (connection.models[OUTBOX_EVENT_MODEL_NAME] as
        | Model<OutboxEventDocument>
        | undefined) ??
      connection.model<OutboxEventDocument>(
        OUTBOX_EVENT_MODEL_NAME,
        outboxEventSchema,
      );
  }

  /**
   * Añade el evento como pendiente y vencido: `nextAttemptAt = now` hace que el relay lo tome en su siguiente vuelta.
   * Todos los campos de estado se escriben explícitos (`publishedAt`, `failedAt`, `attempts`), para que el documento
   * diga en qué estado está en lugar de dejarlo a la ausencia de campos.
   *
   * Va en la sesión de la transacción del alta: si la transacción no confirma, el evento no queda, y si el evento no se
   * puede escribir, tampoco queda el agregado. El error se propaga tal cual: quien abrió la transacción la aborta.
   */
  async append(
    event: OutboxEvent,
    session: TransactionSession,
  ): Promise<void> {
    const now = this.clock.now();
    await this.events.create(
      [
        {
          type: event.type,
          payload: event.payload,
          createdAt: now,
          publishedAt: null,
          failedAt: null,
          attempts: 0,
          nextAttemptAt: now,
        },
      ],
      // La sesión es opaca para `application`; aquí, donde vive Mongo, se sabe que es la de Mongoose.
      { session: session as ClientSession },
    );
  }

  /**
   * Eventos pendientes cuyo momento de reintento ya pasó, de más antiguo a más nuevo (D6). El orden es de creación, no
   * de vencimiento: un evento que lleva un rato esperando no se queda detrás de otro recién escrito.
   */
  async takeDue(now: Date, limit: number): Promise<PendingOutboxEvent[]> {
    const documents = await this.events
      .find({ publishedAt: null, failedAt: null, nextAttemptAt: { $lte: now } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean()
      .exec();
    return documents.map((document) => ({
      id: document._id.toHexString(),
      type: document.type,
      payload: document.payload,
      attempts: document.attempts,
      createdAt: document.createdAt,
    }));
  }

  /** Marca el evento como publicado. Solo se llama cuando la cola ya confirmó el job. */
  async markPublished(id: string, now: Date): Promise<void> {
    await this.events
      .updateOne({ _id: new Types.ObjectId(id) }, { $set: { publishedAt: now } })
      .exec();
  }

  /** Apunta el intento fallido y cuándo se puede volver a intentar. El evento sigue pendiente. */
  async scheduleRetry(
    id: string,
    attempts: number,
    nextAttemptAt: Date,
  ): Promise<void> {
    await this.events
      .updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { attempts, nextAttemptAt } },
      )
      .exec();
  }

  /** Da el evento por agotado: deja de tomarse, porque el índice parcial solo mira los que siguen vivos. */
  async markFailed(id: string, attempts: number, now: Date): Promise<void> {
    await this.events
      .updateOne(
        { _id: new Types.ObjectId(id) },
        { $set: { failedAt: now, attempts } },
      )
      .exec();
  }
}
