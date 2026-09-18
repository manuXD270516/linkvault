import type { LinkEnrichedPayload } from '@linkvault/shared';

// Puerto del canal por el que llegan los avisos de enriquecimiento (D9 de link-enrichment). El worker publica un aviso
// mínimo —identificador, estado y versión— y `api` lo reparte: el canal no sabe quién puede ver qué, así que el aviso
// no puede llevar el preview dentro. Solo tipos y el token; el adaptador va sobre Redis.

export const ENRICHMENT_NOTICES = Symbol('ENRICHMENT_NOTICES');

export interface EnrichmentNotices {
  /**
   * Escucha los avisos. La suscripción es **una por proceso**: cada instancia de `api` reparte a sus propias conexiones
   * abiertas, así que abrir una por petición sería una conexión a Redis por pestaña.
   *
   * Devuelve cómo dejar de escuchar. Un aviso que no cumple su contrato se descarta sin tocar nada: por ese canal puede
   * llegar cualquier cosa.
   */
  subscribe(
    handler: (payload: LinkEnrichedPayload) => Promise<void>,
  ): Promise<() => Promise<void>>;
}
