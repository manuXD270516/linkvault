import type { EmbeddingProvider } from './ports/embedding-provider.port';
import type { AiConsent } from './run-context';

// Selección pura de proveedores de embeddings (ADR-036 / ADR-014). Sin red ni I/O.

export interface EmbedChainRequest {
  /** Consentimiento del dueño del agregado (indexación) o del usuario que busca (query). */
  aiConsent: AiConsent;
  providers: readonly EmbeddingProvider[];
  openIds: ReadonlySet<string>;
}

export interface EmbedChainResult {
  providers: EmbeddingProvider[];
  /**
   * `true` si sin consentimiento no hay cadena útil pero con permiso externo sí habría
   * al menos un proveedor adicional.
   */
  consentWouldEnable: boolean;
}

/**
 * Cadena de embeddings: filtra circuitos abiertos y, sin consentimiento, proveedores `external`.
 * Orden: local antes que externo → menor coste → orden de `AI_EMBED_CHAIN`.
 */
export function buildEmbedChain(request: EmbedChainRequest): EmbedChainResult {
  const providers = selectEligible(request);
  return {
    providers,
    consentWouldEnable: computeConsentWouldEnable(request, providers),
  };
}

function selectEligible(request: EmbedChainRequest): EmbeddingProvider[] {
  const blockExternal = !request.aiConsent.externalProviders;
  return request.providers
    .map((provider, chainIndex) => ({ provider, chainIndex }))
    .filter(
      ({ provider }) =>
        provider.capabilities.embeddings &&
        !request.openIds.has(provider.id) &&
        !(blockExternal && provider.capabilities.external),
    )
    .sort(
      (a, b) =>
        compareProviders(a.provider, b.provider) || a.chainIndex - b.chainIndex,
    )
    .map(({ provider }) => provider);
}

function computeConsentWouldEnable(
  request: EmbedChainRequest,
  real: readonly EmbeddingProvider[],
): boolean {
  if (request.aiConsent.externalProviders) return false;
  const hypothetical = selectEligible({
    ...request,
    aiConsent: { externalProviders: true },
  });
  const realIds = new Set(real.map((p) => p.id));
  return hypothetical.some((provider) => !realIds.has(provider.id));
}

function compareProviders(a: EmbeddingProvider, b: EmbeddingProvider): number {
  const locality =
    Number(a.capabilities.external) - Number(b.capabilities.external);
  if (locality !== 0) return locality;
  return a.capabilities.costPer1kTokens - b.capabilities.costPer1kTokens;
}
