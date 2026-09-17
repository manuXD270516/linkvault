import { Schema, type Types } from 'mongoose';

// Colección `outbox_events` (D6 de job-links, ADR-009). Es plataforma, no un módulo de dominio: cualquier caso de uso
// que deba encolar trabajo escribe aquí su evento dentro de su misma transacción, y el relay lo publica después.
//
// Un evento vive en tres estados y ninguno se deduce de la ausencia de un campo: pendiente (`publishedAt` y `failedAt`
// nulos), publicado (`publishedAt` con fecha) y agotado (`failedAt` con fecha). Escribirlos siempre explícitamente es
// lo que permite que el índice parcial los encuentre; un documento sin el campo también casaría con `null`, pero así no
// hay que confiar en ello. `bufferCommands: false`: sin conexión, una operación falla enseguida en vez de encolarse.

export const OUTBOX_EVENT_MODEL_NAME = 'OutboxEvent';
export const OUTBOX_EVENTS_COLLECTION = 'outbox_events';

export interface OutboxEventDocument {
  _id: Types.ObjectId;
  /** Tipo versionado del evento, tal y como lo declara su contrato en `libs/shared/events`. */
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  /** Fecha en que la cola confirmó la publicación; `null` mientras siga pendiente. */
  publishedAt: Date | null;
  /** Fecha en que se dio por agotado tras 24 h sin conseguir publicarlo; `null` mientras siga vivo. */
  failedAt: Date | null;
  attempts: number;
  /** A partir de cuándo el relay puede volver a intentarlo (espera creciente entre fallos). */
  nextAttemptAt: Date;
}

export const outboxEventSchema = new Schema<OutboxEventDocument>(
  {
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, required: true },
    // `required` rechazaría el `null` que significa "todavía pendiente": el valor por defecto lo escribe igualmente.
    publishedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    attempts: { type: Number, required: true, default: 0 },
    nextAttemptAt: { type: Date, required: true },
  },
  {
    bufferCommands: false,
    versionKey: false,
    strict: true,
    // Sin `minimize`, un payload vacío desaparecería del documento y el evento llegaría a la cola sin datos.
    minimize: false,
    collection: OUTBOX_EVENTS_COLLECTION,
  },
);

/**
 * Único índice de la colección (D6): los pendientes vencidos, en orden de creación. Es parcial a propósito, para que el
 * índice solo guarde el trabajo vivo y no crezca con todo lo ya publicado, que es la inmensa mayoría.
 */
outboxEventSchema.index(
  { nextAttemptAt: 1, createdAt: 1 },
  { partialFilterExpression: { publishedAt: null, failedAt: null } },
);
