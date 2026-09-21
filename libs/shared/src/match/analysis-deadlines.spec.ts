import { describe, expect, it } from 'vitest';
import {
  MATCH_ANALYSIS_DEADLINE_MARGIN_MS,
  MATCH_ANALYSIS_DELIVERIES,
  assertAnalysisDeadlines,
} from './analysis-deadlines';

describe('assertAnalysisDeadlines', () => {
  it.each([
    {
      // Valores de `.env.example` (×2 cv-suggestions-review): holgados frente a timeout + margen.
      name: 'holgado',
      maxAgeMs: 240_000,
      timeoutMs: 120_000,
      deliveries: 1,
      marginMs: 15_000,
      ok: true,
    },
    {
      // Justo en el límite: maxAge === timeout * deliveries + margin → no cumple "mayor".
      name: 'justo en el límite',
      maxAgeMs: 75_000,
      timeoutMs: 60_000,
      deliveries: 1,
      marginMs: 15_000,
      ok: false,
    },
    {
      name: 'invertido',
      maxAgeMs: 30_000,
      timeoutMs: 60_000,
      deliveries: 1,
      marginMs: 15_000,
      ok: false,
    },
    {
      name: 'iguales',
      maxAgeMs: 60_000,
      timeoutMs: 60_000,
      deliveries: 1,
      marginMs: 0,
      ok: false,
    },
  ])('$name', ({ maxAgeMs, timeoutMs, deliveries, marginMs, ok }) => {
    const call = () =>
      assertAnalysisDeadlines({ maxAgeMs, timeoutMs, deliveries, marginMs });

    if (ok) {
      expect(call).not.toThrow();
      return;
    }

    expect(call).toThrow(/MATCH_ANALYSIS_MAX_AGE_MS/);
    expect(call).toThrow(/MATCH_ANALYSIS_TIMEOUT_MS/);
    expect(call).toThrow(String(maxAgeMs));
    expect(call).toThrow(String(timeoutMs));
  });

  it('exports the delivery count and margin the apps use at startup', () => {
    expect(MATCH_ANALYSIS_DELIVERIES).toBe(1);
    expect(MATCH_ANALYSIS_DEADLINE_MARGIN_MS).toBe(15_000);
  });
});
