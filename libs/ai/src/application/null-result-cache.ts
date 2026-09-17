import type {
  CachedResult,
  ResultCache,
} from '../domain/ports/result-cache.port';

// Caché nula (D8 de ai-gateway-core, ADR-018 §6): nunca lee ni escribe. Se usa cuando AI_CHAIN incluye `mock`, para
// que los tests y el desarrollo con fixtures no oculten cambios tras una entrada de caché.

export class NullResultCache implements ResultCache {
  get(): Promise<CachedResult | null> {
    return Promise.resolve(null);
  }

  set(): Promise<void> {
    return Promise.resolve();
  }
}

/** Id del proveedor mock en AI_CHAIN. */
export const MOCK_PROVIDER_ID = 'mock';

/** La caché que debe usar una cadena: nula si incluye el mock (D8). */
export function cacheForChain(
  providers: readonly { id: string }[],
  cache: ResultCache,
): ResultCache {
  return providers.some((provider) => provider.id === MOCK_PROVIDER_ID)
    ? new NullResultCache()
    : cache;
}
