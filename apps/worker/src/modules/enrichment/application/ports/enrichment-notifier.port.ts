import type { LinkEnrichedEvent } from '@linkvault/shared';

// Puerto del aviso de que un link terminó su enriquecimiento (D9 de link-enrichment). Solo tipos y el token.
//
// El worker no habla con navegadores: publica un aviso mínimo y `api` es quien resuelve quién puede ver ese link y lo
// reparte por SSE. Por eso el evento lleva solo identificador, estado y versión: el canal no sabe quién ve qué.

export const ENRICHMENT_NOTIFIER = Symbol('ENRICHMENT_NOTIFIER');

export interface EnrichmentNotifier {
  /**
   * Publica el aviso. **Nunca lanza**: el preview ya está escrito en Mongo cuando esto se llama, y no avisar solo
   * significa que una pantalla abierta se entera al recargar. Fallar el job por eso volvería a descargar la página.
   */
  publish(event: LinkEnrichedEvent): Promise<void>;
}
