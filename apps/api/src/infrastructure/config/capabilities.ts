import type { CapabilitiesResponse } from '@linkvault/shared';
import type { ApiConfig } from './api-config.schema';

/**
 * Única definición de las capacidades del despliegue (D2 de web-shell-capabilities). Describe lo configurado, no la
 * salud del servicio: una avería transitoria de Meilisearch o de una bolsa no cambia el valor.
 *
 * - `search`: bandera encendida **y** host de Meilisearch no vacío (sin host la búsqueda no puede funcionar).
 * - `discovery`: bandera encendida (`DISCOVERY_CHAIN=mock` cuenta como activo).
 */
export function deriveCapabilities(config: ApiConfig): CapabilitiesResponse {
  return {
    search: config.FEATURE_SEARCH && config.MEILI_HOST !== '',
    discovery: config.FEATURE_DISCOVERY,
  };
}
