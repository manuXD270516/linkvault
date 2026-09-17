import type { PendingOutboxEvent } from './mongo-outbox';

// Salida del relay (D6 de job-links): publicar un evento pendiente en su cola. Es un puerto para que los tests del
// relay usen una cola falsa y no dependan de Redis; el adaptador real es `BullmqOutboxPublisher`.

export const OUTBOX_PUBLISHER = Symbol('OUTBOX_PUBLISHER');

export interface OutboxPublisher {
  /**
   * Publica el evento con un `jobId` determinista derivado de él. Solo resuelve cuando la cola confirma: si rechaza,
   * lanza y el relay deja el evento pendiente para reintentarlo.
   */
  publish(event: PendingOutboxEvent): Promise<void>;
}
