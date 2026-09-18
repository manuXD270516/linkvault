import type { JobLinkSummary } from '@linkvault/shared';
import { LINK_ENRICHED_EVENT_NAME, linkEnrichedMessage } from '@linkvault/shared';
import { Injectable } from '@nestjs/common';
import { EventStreamRegistry } from '../../../infrastructure/realtime/event-stream.registry';
import type { EnrichmentBroadcaster } from '../application/ports/enrichment-broadcaster.port';

/**
 * Adaptador ENRICHMENT_BROADCASTER sobre el registro de conexiones del canal de eventos (D9). Aquí es donde el link se
 * convierte en el mensaje que sale hacia el navegador: el nombre del evento y la forma del cuerpo son del contrato de
 * `libs/shared`, no de este archivo, para que el SPA no tenga que adivinarlos.
 */
@Injectable()
export class EventStreamBroadcaster implements EnrichmentBroadcaster {
  constructor(private readonly streams: EventStreamRegistry) {}

  hasListeners(): boolean {
    return this.streams.hasListeners;
  }

  send(userId: string, link: JobLinkSummary): number {
    return this.streams.publish(
      userId,
      LINK_ENRICHED_EVENT_NAME,
      JSON.stringify(linkEnrichedMessage(link)),
    );
  }
}
