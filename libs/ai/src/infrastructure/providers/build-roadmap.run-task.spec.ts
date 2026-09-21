import { type BuildRoadmapInput } from '@linkvault/shared';
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
import { searchCatalog } from '../catalog/search-catalog';
import { InMemoryCircuitBreaker } from '../resilience/in-memory-circuit-breaker';
import {
  buildRoadmapOutputSchema,
  buildRoadmapTask,
} from '../../tasks/build-roadmap.task';

// Camino de salida inválida y «modelo miente verified» (spec ai/task-execution).

const PROMPTS_DIR = join(import.meta.dirname, '../prompts');

const INPUT: BuildRoadmapInput = {
  missingSkills: [{ name: 'TypeScript', importance: 'must' }],
  job: {
    title: 'Backend',
    skills: [{ name: 'TypeScript', importance: 'must' }],
  },
};

function createRunTask(providers: FakeLlmProvider[]): RunTask {
  const clock = new ManualClock();
  return new RunTask({
    providers,
    prompts: new FilePromptRegistry({ promptsDir: PROMPTS_DIR }),
    cache: new InMemoryResultCache(),
    ledger: new InMemoryUsageLedger(),
    quota: new InMemoryQuotaPolicy(),
    breaker: new InMemoryCircuitBreaker(clock),
    clock,
    logger: new InMemoryAiLogger(),
    pendingFixtures: null,
  });
}

describe('runTask build-roadmap invalid output path', () => {
  it('repara y, si no valida, no inventa un roadmap verificado', async () => {
    const invalid = JSON.stringify({
      plan: 'estudia TypeScript',
      verified: true,
    });
    const first = new FakeLlmProvider('ollama', [invalid, invalid]);
    const second = new FakeLlmProvider('openrouter', [invalid, invalid], {
      capabilities: { external: true },
    });
    const cache = new InMemoryResultCache();
    const clock = new ManualClock();
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

    const result = await runTask.execute(buildRoadmapTask, INPUT, {
      aiConsent: { externalProviders: true },
    });

    expect(first.calls).toBe(2);
    expect(second.calls).toBe(2);
    expect(result).toMatchObject({
      status: 'degraded',
      reason: 'providers_failed',
    });
    expect(result).not.toHaveProperty('output');
    expect(buildRoadmapOutputSchema.safeParse(result).success).toBe(false);
    expect(cache.sets).toBe(0);
  });
});

describe('runTask build-roadmap modelo miente verified', () => {
  it('post-proceso deja verified false en recursos fuera del catálogo', async () => {
    const catalog = searchCatalog('TypeScript')[0]!;
    const lying = JSON.stringify({
      items: [
        {
          skill: 'TypeScript',
          priority: 1,
          estimatedWeeks: 2,
          resources: [
            {
              type: 'course',
              title: 'Bootcamp inventado',
              url: 'https://example.com/fake-bootcamp',
              provider: 'example.com',
              free: true,
              verified: true,
            },
            { ...catalog, verified: true },
          ],
        },
      ],
    });
    const provider = new FakeLlmProvider('ollama', [lying]);
    const runTask = createRunTask([provider]);

    const result = await runTask.execute(buildRoadmapTask, INPUT, {
      aiConsent: { externalProviders: false },
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.output.items[0]?.resources[0]?.verified).toBe(false);
    expect(result.output.items[0]?.resources[1]?.verified).toBe(true);
  });
});
