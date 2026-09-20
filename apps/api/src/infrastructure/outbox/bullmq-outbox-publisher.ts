import type { PendingOutboxEvent } from './mongo-outbox';
import { outboxRouteOf } from './outbox-routes';
import type { OutboxPublisher } from './outbox-publisher.port';

// Adaptador de OUTBOX_PUBLISHER sobre las colas de BullMQ (D6 de job-links, D11 de cv-upload-extract).

/** Lo que el relay necesita de una cola: encolar un job con su identificador. Lo cumple la `Queue` de BullMQ. */
export interface JobQueue {
  add(
    name: string,
    data: Record<string, unknown>,
    options: { jobId: string },
  ): Promise<unknown>;
}

/**
 * Publica cada evento en **la cola de su tipo**, con el `jobId` determinista de su contrato: mientras el job vive,
 * republicar el mismo evento no crea un segundo job (idempotencia de D6). Qué cola, qué schema y qué `jobId` lo dice
 * la tabla de `outbox-routes`, no este adaptador.
 *
 * Dos cosas lanzan, y las dos dejan el evento pendiente para que el relay lo reintente y lo agote a las 24 h con su
 * aviso, que es lo correcto: un **tipo desconocido**, porque un evento que no sabemos publicar no debe desaparecer en
 * silencio ni acabar en la cola de otro; y un **payload que no cumple su schema**, porque un documento roto no debe
 * llegar a su consumidor.
 */
export class BullmqOutboxPublisher implements OutboxPublisher {
  constructor(private readonly queues: ReadonlyMap<string, JobQueue>) {}

  async publish(event: PendingOutboxEvent): Promise<void> {
    const route = outboxRouteOf(event.type);
    if (route === undefined) {
      throw new Error(`Unknown outbox event type: ${event.type}`);
    }
    const queue = this.queues.get(route.queue);
    if (queue === undefined) {
      throw new Error(`No queue registered for ${route.queue}`);
    }
    const job = route.job(event.payload);
    await queue.add(event.type, job.data, { jobId: job.jobId });
  }
}
