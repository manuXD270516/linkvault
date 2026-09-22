import type { CircuitBreaker } from '../domain/ports/circuit-breaker.port';
import type { LlmProvider } from '../domain/ports/llm-provider.port';
import type { AiConsent } from '../domain/run-context';
import { buildChain } from '../domain/routing-policy';
import type { AiTask } from '../domain/task';
import type { ByokProvidersSource } from '../infrastructure/providers/byok-provider.factory';

// Consulta de solo lectura: ¿habría hoy algún proveedor elegible? (cv-match-suggestions 4.3, ADR-030 §8, ADR-032 D11).
// No ejecuta la tarea ni contacta a ningún proveedor: solo compone la cadena con la instantánea de circuitos.
// El universo efectivo incluye BYOK del `userId` cuando se pasa (D8 / D11).

export type ProviderEligibilityQuery = {
  task: Pick<AiTask<unknown, unknown>, 'requires' | 'dataSensitivity'>;
  aiConsent: AiConsent;
  /** Sin userId no se consultan claves BYOK. */
  userId?: string;
};

/**
 * `ready`: se pudo obtener la instantánea. `unavailable`: Redis (u otro almacén) no respondió —
 * distinto de «no hay ninguno».
 *
 * `hasEligibleByok`: hay ≥1 proveedor `byok:*` elegible del `userId` (ADR-032 D11 / vigencia
 * `quota_exceeded` en match). Independiente de si la cadena de plataforma también es elegible.
 */
export type ProviderEligibilityResult =
  | {
      status: 'ready';
      hasEligible: boolean;
      hasEligibleByok: boolean;
      consentWouldEnable: boolean;
    }
  | { status: 'unavailable' };

export interface ProviderEligibility {
  hasEligibleProvider(
    query: ProviderEligibilityQuery,
  ): Promise<ProviderEligibilityResult>;
}

export interface DefaultProviderEligibilityOptions {
  platformProviders: readonly LlmProvider[];
  breaker: CircuitBreaker;
  byokFactory?: ByokProvidersSource;
}

export class DefaultProviderEligibility implements ProviderEligibility {
  private readonly platformProviders: readonly LlmProvider[];
  private readonly breaker: CircuitBreaker;
  private readonly byokFactory: ByokProvidersSource | undefined;

  constructor(
    options: DefaultProviderEligibilityOptions | readonly LlmProvider[],
    breaker?: CircuitBreaker,
  ) {
    if (isOptions(options)) {
      this.platformProviders = options.platformProviders;
      this.breaker = options.breaker;
      this.byokFactory = options.byokFactory;
    } else {
      // Compat: `new DefaultProviderEligibility(providers, breaker)`.
      this.platformProviders = options;
      this.breaker = breaker as CircuitBreaker;
      this.byokFactory = undefined;
    }
  }

  async hasEligibleProvider(
    query: ProviderEligibilityQuery,
  ): Promise<ProviderEligibilityResult> {
    const openIds = await this.breaker.snapshotOpenIds();
    if (openIds === null) {
      return { status: 'unavailable' };
    }

    const byok =
      this.byokFactory === undefined
        ? []
        : await this.byokFactory.providersFor(query.userId);
    const universe = [...byok, ...this.platformProviders];

    const { providers, consentWouldEnable } = buildChain({
      task: query.task,
      ctx: { aiConsent: query.aiConsent },
      providers: universe,
      openIds,
    });

    const byokChain = buildChain({
      task: query.task,
      ctx: { aiConsent: query.aiConsent },
      providers: byok,
      openIds,
    });

    return {
      status: 'ready',
      hasEligible: providers.length > 0,
      hasEligibleByok: byokChain.providers.length > 0,
      consentWouldEnable,
    };
  }
}

function isOptions(
  value: DefaultProviderEligibilityOptions | readonly LlmProvider[],
): value is DefaultProviderEligibilityOptions {
  return !Array.isArray(value) && 'platformProviders' in value;
}
