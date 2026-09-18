import type { JobLinkSummary } from '@linkvault/shared';

// Puerto de salida hacia el navegador (D9 de link-enrichment). `links` decide **a quién** y **qué**; cómo viaja eso hasta
// una pestaña abierta es del canal de eventos, que es plataforma y no sabe lo que es un link.

export const ENRICHMENT_BROADCASTER = Symbol('ENRICHMENT_BROADCASTER');

export interface EnrichmentBroadcaster {
  /** `true` si hay alguna conexión abierta en este proceso. Sin ninguna, el aviso se descarta sin leer nada. */
  hasListeners(): boolean;
  /** Envía el link a las conexiones abiertas de esa persona y dice a cuántas llegó. */
  send(userId: string, link: JobLinkSummary): number;
}
