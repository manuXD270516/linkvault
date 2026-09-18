import {
  LINK_CREATED_EVENT_TYPE,
  linkCreatedEventSchema,
  linkCreatedJobId,
  type LinkCreatedPayload,
} from '@linkvault/shared';
import type { PendingOutboxEvent } from './mongo-outbox';
import type { OutboxPublisher } from './outbox-publisher.port';

// Adaptador de OUTBOX_PUBLISHER sobre la cola `enrich-link` de BullMQ (D6 de job-links).

/** Lo que el relay necesita de la cola: encolar un job con su identificador. Lo cumple la `Queue` de BullMQ. */
export interface JobQueue {
  add(
    name: string,
    data: LinkCreatedPayload,
    options: { jobId: string },
  ): Promise<unknown>;
}

/**
 * Publica el evento en la cola con el `jobId` determinista de su contrato: mientras el job vive, republicar el mismo
 * evento no crea un segundo job (idempotencia de D6).
 *
 * El contenido se valida con el schema compartido antes de encolar: un documento que no cumple el contrato no llega a
 * `link-enrichment`, se queda pendiente y termina agotándose a las 24 h con su aviso, en vez de envenenar la cola.
 */
export class BullmqOutboxPublisher implements OutboxPublisher {
  constructor(private readonly queue: JobQueue) {}

  async publish(event: PendingOutboxEvent): Promise<void> {
    if (event.type !== LINK_CREATED_EVENT_TYPE) {
      throw new Error(`Unknown outbox event type: ${event.type}`);
    }
    const { payload } = linkCreatedEventSchema.parse({
      type: event.type,
      payload: event.payload,
    });
    await this.queue.add(event.type, payload, {
      jobId: linkCreatedJobId(payload),
    });
  }
}
