import type { TransactionSession } from './transaction-session';

// Puerto del outbox (ADR-009, D6 de job-links). El caso de uso escribe el evento **dentro** de la transacción del alta y
// nunca publica en la cola: de eso se encarga el relay. Solo tipos y el token; el adaptador vive en
// `apps/api/src/infrastructure/outbox`, que es plataforma y no un módulo de dominio.

export const OUTBOX = Symbol('OUTBOX');

/** Evento de integración tal y como se guarda: su tipo versionado y su payload (contratos en `libs/shared/events`). */
export interface OutboxEvent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface Outbox {
  /** Añade el evento como pendiente. Si la transacción no llega a confirmarse, el evento tampoco queda. */
  append(event: OutboxEvent, session: TransactionSession): Promise<void>;
}
