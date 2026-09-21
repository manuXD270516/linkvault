import type { AiResult } from '../../domain/ai-result';
import type { CaseResult } from '../evaluable-task';

// Constructor de `CaseResult` para tests de métricas, reporte y línea base. Fuera del build de la lib (`*.spec-helper.ts`),
// junto a las métricas para no importar `application/testing/**` desde `evals/` (D1).

export interface TestCaseOptions<I, O, E> {
  id: string;
  input: I;
  expected: E;
  result: AiResult<O>;
  latencyMs?: number;
  estCost?: number;
  tags?: readonly string[];
}

export function testCaseResult<I, O, E>(
  options: TestCaseOptions<I, O, E>,
): CaseResult<I, O, E> {
  return {
    goldenCase: {
      line: 1,
      id: options.id,
      input: options.input,
      expected: options.expected,
      tags: options.tags ?? [],
      key: '0'.repeat(64),
    },
    result: options.result,
    latencyMs: options.latencyMs ?? 0,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      estCost: options.estCost ?? 0,
      outcomes: [options.result.status === 'success' ? 'success' : 'degraded'],
      rounds: [
        {
          round: 0,
          task: 'test',
          estCost: options.estCost ?? 0,
          latencyMs: options.latencyMs ?? 0,
        },
      ],
    },
  };
}

export function success<O>(output: O, model = 'test-model'): AiResult<O> {
  return {
    status: 'success',
    output,
    providerId: 'mock',
    model,
    promptVersion: 'v1',
    cached: false,
  };
}

export function degraded<O>(): AiResult<O> {
  return { status: 'degraded', reason: 'providers_failed' };
}
