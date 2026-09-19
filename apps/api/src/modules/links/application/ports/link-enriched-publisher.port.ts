import type { LinkEnrichedPayload } from '@linkvault/shared';

// Puerto de publicación del aviso de link enriquecido (D6 de paste-job-description, spec platform/realtime). Pegar la
// descripción o corregir a mano cambian el preview igual que un enriquecimiento, y las demás pantallas abiertas tienen
// que enterarse. El aviso se publica en el **mismo canal de Redis** en el que publica el worker, y no se reparte solo
// en este proceso: así llega a todas las instancias de `api`, incluida esta, y lo reparte `DeliverLinkEnriched` como
// cualquier otro. Solo tipos y el token.

export const LINK_ENRICHED_PUBLISHER = Symbol('LINK_ENRICHED_PUBLISHER');

export interface LinkEnrichedPublisher {
  /**
   * Publica el aviso. **Nunca lanza**: cuando se llama, el preview ya está escrito, y un Redis caído solo significa que
   * una pantalla abierta no se entera sola; al recargar, el listado trae la verdad. Quien llama no espera a que termine.
   */
  publish(payload: LinkEnrichedPayload): Promise<void>;
}
