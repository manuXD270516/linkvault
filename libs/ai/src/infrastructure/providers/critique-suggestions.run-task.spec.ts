import {
  critiqueSuggestionsOutputSchema,
  type CritiqueSuggestionsInput,
} from '@linkvault/shared';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RunTask } from '../../application/run-task.usecase';
import {
  InMemoryAiLogger,
  InMemoryQuotaPolicy,
  InMemoryResultCache,
  InMemoryUsageLedger,
  ManualClock,
} from '../../application/testing/in-memory-ports';
import { FakeLlmProvider } from '../../application/testing/fake-llm-provider';
import { FilePromptRegistry } from '../prompt-registry/file-prompt-registry';
import { InMemoryCircuitBreaker } from '../resilience/in-memory-circuit-breaker';
import { critiqueSuggestionsTask } from '../../tasks/critique-suggestions.task';

// Camino de salida inválida de `critique-suggestions` (spec ai/task-execution: «Salida que no valida»).

const PROMPTS_DIR = join(import.meta.dirname, '../prompts');

const INPUT: CritiqueSuggestionsInput = {
  job: {
    title: 'Backend',
    text: 'Buscamos TypeScript y Kubernetes.',
    skills: [
      { name: 'TypeScript', importance: 'must' },
      { name: 'Kubernetes', importance: 'must' },
    ],
  },
  report: {
    score: 70,
    matchedSkills: ['TypeScript'],
    missingSkills: [{ name: 'Kubernetes', importance: 'must' }],
    suggestions: [
      {
        section: 'skills',
        after: 'Incluir experiencia con Kubernetes.',
        reason: 'La vacante exige Kubernetes.',
        evidence: {
          jobRequirement: 'Kubernetes',
          importance: 'must',
        },
      },
    ],
  },
};

describe('runTask critique-suggestions invalid output path', () => {
  it('repara y, si no valida, no inventa un score', async () => {
    // Ni score 0–1 ni issues: no es la salida del juez.
    const invalid = JSON.stringify({
      score: 'excelente',
      notes: ['demasiado genérico'],
    });
    const stillInvalid = invalid;
    const first = new FakeLlmProvider('ollama', [invalid, stillInvalid]);
    const second = new FakeLlmProvider('openrouter', [invalid, stillInvalid], {
      capabilities: { external: true },
    });
    const clock = new ManualClock();
    const cache = new InMemoryResultCache();
    const runTask = new RunTask({
      providers: [first, second],
      prompts: new FilePromptRegistry({ promptsDir: PROMPTS_DIR }),
      cache,
      ledger: new InMemoryUsageLedger(),
      quota: new InMemoryQuotaPolicy(),
      breaker: new InMemoryCircuitBreaker(clock),
      clock,
      logger: new InMemoryAiLogger(),
      pendingFixtures: null,
    });

    const result = await runTask.execute(critiqueSuggestionsTask, INPUT, {
      aiConsent: { externalProviders: true },
    });

    expect(first.calls).toBe(2);
    expect(second.calls).toBe(2);
    expect(result).toMatchObject({
      status: 'degraded',
      reason: 'providers_failed',
    });
    // Sin `degrade`: no hay output inventado ni score.
    expect(result).not.toHaveProperty('output');
    expect(critiqueSuggestionsOutputSchema.safeParse(result).success).toBe(
      false,
    );
    expect(cache.sets).toBe(0);
    expect(cache.entries.size).toBe(0);
  });
});
