import type {
  LlmProvider,
  ProviderCapabilities,
} from './ports/llm-provider.port';
import type { RunContext } from './run-context';
import { dataSensitivityOf, type AiTask } from './task';

// Política de routing pura (design-v0.2 §4.4, ADR-014, ADR-018 §7, §8 y §11, D2 y D10 de ai-gateway-core;
// `consentWouldEnable` de cv-match-suggestions / ADR-030).
// Sin red ni almacenamiento: recibe los proveedores de AI_CHAIN en su orden y una instantánea de circuitos abiertos.

const BYOK_PREFIX = 'byok:';

/**
 * Capacidades que satisfacen lo requerido por la tarea: cada booleano requerido a `true` exige `true` y
 * `maxContextTokens` se compara con `>=`. Costes y `external` son de política, no de capacidad: se ignoran.
 */
export function satisfies(
  capabilities: ProviderCapabilities,
  requires: Partial<ProviderCapabilities>,
): boolean {
  if (requires.jsonMode === true && !capabilities.jsonMode) return false;
  if (requires.toolUse === true && !capabilities.toolUse) return false;
  if (
    requires.maxContextTokens !== undefined &&
    capabilities.maxContextTokens < requires.maxContextTokens
  ) {
    return false;
  }
  return true;
}

export interface ChainRequest {
  task: Pick<AiTask<unknown, unknown>, 'requires' | 'dataSensitivity'>;
  ctx: Pick<RunContext, 'aiConsent' | 'excludeProviderIds'>;
  /** Universo configurado, en el orden de AI_CHAIN (último desempate). */
  providers: readonly LlmProvider[];
  /** Circuitos abiertos que aún no admiten prueba (`CircuitBreaker.openIds()`). */
  openIds: ReadonlySet<string>;
}

/**
 * Resultado de componer la cadena. `consentWouldEnable` es un hecho puro: la política NO decide el motivo de
 * degradación; eso lo hace `runTask` (tarea 3.5).
 */
export interface ChainResult {
  providers: LlmProvider[];
  /**
   * `true` solo si la tarea es `personal`, el contexto llega sin consentimiento y la cadena hipotética (con el
   * permiso supuesto) contiene al menos un proveedor que la cadena real no contiene.
   */
  consentWouldEnable: boolean;
}

/**
 * Cadena de proveedores elegibles y ordenados, más el hecho de si conceder el consentimiento habría habilitado
 * a alguien. Filtra por capacidades, circuitos abiertos y, solo en tareas `personal` sin consentimiento,
 * proveedores externos. Orden (ADR-018 §8): BYOK → menor coste de salida → local antes que externo → mayor
 * contexto → orden en AI_CHAIN.
 */
export function buildChain(request: ChainRequest): ChainResult {
  const providers = selectEligible(request);
  return {
    providers,
    consentWouldEnable: computeConsentWouldEnable(request, providers),
  };
}

/**
 * Selección pura de elegibles. Extraída para poder componer la cadena hipotética con el mismo filtrado.
 */
function selectEligible(request: ChainRequest): LlmProvider[] {
  const { task, ctx, providers, openIds } = request;
  const blockExternal =
    dataSensitivityOf(task) === 'personal' && !ctx.aiConsent.externalProviders;

  const eligible = providers
    .map((provider, chainIndex) => ({ provider, chainIndex }))
    .filter(
      ({ provider }) =>
        satisfies(provider.capabilities, task.requires) &&
        !openIds.has(provider.id) &&
        !(blockExternal && provider.capabilities.external),
    )
    .sort(
      (a, b) =>
        compareProviders(a.provider, b.provider) || a.chainIndex - b.chainIndex,
    )
    .map(({ provider }) => provider);

  // C19 / juez distinto: excluir solo si queda al menos un elegible; si no, se usa el mismo.
  const excluded = ctx.excludeProviderIds;
  if (excluded === undefined || excluded.length === 0) {
    return eligible;
  }
  const excludedIds = new Set(excluded);
  const withoutExcluded = eligible.filter(
    (provider) => !excludedIds.has(provider.id),
  );
  return withoutExcluded.length > 0 ? withoutExcluded : eligible;
}

/**
 * Segunda cadena hipotética con consentimiento supuesto y todo lo demás igual. `true` solo cuando esa cadena
 * añade al menos un proveedor que la real no tiene.
 */
function computeConsentWouldEnable(
  request: ChainRequest,
  real: readonly LlmProvider[],
): boolean {
  if (dataSensitivityOf(request.task) !== 'personal') return false;
  if (request.ctx.aiConsent.externalProviders) return false;

  const hypothetical = selectEligible({
    ...request,
    ctx: { aiConsent: { externalProviders: true } },
  });
  const realIds = new Set(real.map((p) => p.id));
  return hypothetical.some((provider) => !realIds.has(provider.id));
}

function compareProviders(a: LlmProvider, b: LlmProvider): number {
  const byok = byokRank(a) - byokRank(b);
  if (byok !== 0) return byok;
  const cost = a.capabilities.costPer1kOut - b.capabilities.costPer1kOut;
  if (cost !== 0) return cost;
  const locality =
    Number(a.capabilities.external) - Number(b.capabilities.external);
  if (locality !== 0) return locality;
  return b.capabilities.maxContextTokens - a.capabilities.maxContextTokens;
}

function byokRank(provider: LlmProvider): number {
  return provider.id.startsWith(BYOK_PREFIX) ? 0 : 1;
}
