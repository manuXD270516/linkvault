import type { CircuitBreaker } from '../domain/ports/circuit-breaker.port';
import type { LlmProvider } from '../domain/ports/llm-provider.port';
import type { AiConsent } from '../domain/run-context';
import { buildChain } from '../domain/routing-policy';
import type { AiTask } from '../domain/task';

// Consulta de solo lectura: ¿habría hoy algún proveedor elegible? (cv-match-suggestions 4.3, ADR-030 §8).
// No ejecuta la tarea ni contacta a ningún proveedor: solo compone la cadena con la instantánea de circuitos.

export type ProviderEligibilityQuery = {
  task: Pick<AiTask<unknown, unknown>, 'requires' | 'dataSensitivity'>;
  aiConsent: AiConsent;
};

/**
 * `ready`: se pudo obtener la instantánea. `unavailable`: Redis (u otro almacén) no respondió —
 * distinto de «no hay ninguno».
 */
export type ProviderEligibilityResult =
  | {
      status: 'ready';
      hasEligible: boolean;
      consentWouldEnable: boolean;
    }
  | { status: 'unavailable' };

export interface ProviderEligibility {
  hasEligibleProvider(
    query: ProviderEligibilityQuery,
  ): Promise<ProviderEligibilityResult>;
}

export class DefaultProviderEligibility implements ProviderEligibility {
  constructor(
    private readonly providers: readonly LlmProvider[],
    private readonly breaker: CircuitBreaker,
  ) {}

  async hasEligibleProvider(
    query: ProviderEligibilityQuery,
  ): Promise<ProviderEligibilityResult> {
    const openIds = await this.breaker.snapshotOpenIds();
    if (openIds === null) {
      return { status: 'unavailable' };
    }

    const { providers, consentWouldEnable } = buildChain({
      task: query.task,
      ctx: { aiConsent: query.aiConsent },
      providers: this.providers,
      openIds,
    });

    return {
      status: 'ready',
      hasEligible: providers.length > 0,
      consentWouldEnable,
    };
  }
}
