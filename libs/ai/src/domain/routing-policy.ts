import type {
  LlmProvider,
  ProviderCapabilities,
} from './ports/llm-provider.port';
import type { RunContext } from './run-context';
import { dataSensitivityOf, type AiTask } from './task';

// Política de routing pura (design-v0.2 §4.4, ADR-014, ADR-018 §7, §8 y §11, D2 y D10 de ai-gateway-core).
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
  ctx: Pick<RunContext, 'aiConsent'>;
  /** Universo configurado, en el orden de AI_CHAIN (último desempate). */
  providers: readonly LlmProvider[];
  /** Circuitos abiertos que aún no admiten prueba (`CircuitBreaker.openIds()`). */
  openIds: ReadonlySet<string>;
}

/**
 * Cadena de proveedores elegibles y ordenados. Filtra por capacidades, circuitos abiertos y, solo en tareas
 * `personal` sin consentimiento, proveedores externos. Orden (ADR-018 §8): BYOK → menor coste de salida →
 * local antes que externo → mayor contexto → orden en AI_CHAIN.
 */
export function buildChain(request: ChainRequest): LlmProvider[] {
  const { task, ctx, providers, openIds } = request;
  const blockExternal =
    dataSensitivityOf(task) === 'personal' && !ctx.aiConsent.externalProviders;

  return providers
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
