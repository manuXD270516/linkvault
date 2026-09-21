import { ANALYZE_MATCH_QUEUE, EXTRACT_CV_QUEUE } from '@linkvault/shared';
import type { Job, WorkerOptions } from 'bullmq';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RunTaskFn } from '@linkvault/ai';
import { AnalyzeMatchUseCase } from '../../application/analyze-match.usecase';
import {
  ANALYSIS_ID,
  CV_ID,
  InMemoryAiContextReader,
  InMemoryAnalysisRepository,
  InMemoryCvTextReader,
  InMemoryJobReader,
  LINK_ID,
  MovableClock,
  USER_ID,
  sampleJob,
  sampleRunningAnalysis,
} from '../../application/testing/match-test-doubles';
import {
  AnalyzeMatchConsumer,
  MATCH_LOCK_DURATION_MARGIN_MS,
  matchLockDurationFor,
} from './analyze-match.consumer';
import type { WorkerFactory, WorkerHandle } from './worker-factory';

interface Registered {
  queueName: string;
  processor: (job: Job, token?: string) => Promise<void>;
  options: WorkerOptions;
  failedListeners: ((job: Job | undefined, error: Error) => void)[];
  closed: number;
}

let registered: Registered[];
let analyses: InMemoryAnalysisRepository;
let externalSends: number;

const factory: WorkerFactory = (queueName, processor, options) => {
  const entry: Registered = {
    queueName,
    processor,
    options,
    failedListeners: [],
    closed: 0,
  };
  registered.push(entry);
  const handle: WorkerHandle = {
    close: () => {
      entry.closed += 1;
      return Promise.resolve();
    },
    on: (_event, listener) => {
      entry.failedListeners.push(listener);
      return handle;
    },
  };
  return handle;
};

function jobOf(
  data: unknown,
  attemptsMade = 1,
  attempts = 1,
): Job {
  return { id: 'j1', data, attemptsMade, opts: { attempts } } as unknown as Job;
}

const PAYLOAD = {
  analysisId: ANALYSIS_ID,
  userId: USER_ID,
  linkId: LINK_ID,
  cvId: CV_ID,
} as const;

beforeEach(() => {
  registered = [];
  externalSends = 0;
  const clock = new MovableClock();
  analyses = new InMemoryAnalysisRepository();
  analyses.clock = clock;
  analyses.seed(
    sampleRunningAnalysis({
      id: ANALYSIS_ID,
      userId: USER_ID,
      linkId: LINK_ID,
      cvId: CV_ID,
      requestedAt: clock.now(),
    }),
  );
});

function consumer(timeoutMs = 60_000): AnalyzeMatchConsumer {
  const clock = new MovableClock();
  analyses.clock = clock;
  const useCase = new AnalyzeMatchUseCase(
    analyses,
    new InMemoryCvTextReader().with(CV_ID, USER_ID),
    new InMemoryJobReader().with(sampleJob()),
    new InMemoryAiContextReader().with(USER_ID, {
      aiConsent: { externalProviders: true },
    }),
    (async (task, _input, ctx) => {
      if (task.name === 'match-cv' && ctx.aiConsent.externalProviders) {
        // Solo el generador cuenta como envío del CV (ADR-031: el juez no).
        externalSends += 1;
      }
      if (task.name === 'critique-suggestions') {
        return {
          status: 'success',
          output: { score: 0.9, issues: [] },
          providerId: 'ollama',
          model: 'judge',
          promptVersion: 'v1',
          cached: false,
        };
      }
      return {
        status: 'success',
        output: {
          score: 50,
          matchedSkills: [],
          missingSkills: [],
          suggestions: [],
        },
        providerId: 'openrouter',
        model: 'free',
        promptVersion: 'v1',
        cached: false,
      };
    }) as RunTaskFn,
    clock,
    { timeoutMs, maxAgeMs: 120_000 },
  );
  return new AnalyzeMatchConsumer(
    useCase,
    {
      redisUrl: 'redis://127.0.0.1:1',
      concurrency: 2,
      timeoutMs,
    },
    factory,
  );
}

describe('AnalyzeMatchConsumer', () => {
  it('registers its own queue with concurrency and lockDuration from config', () => {
    consumer(45_000).onModuleInit();
    expect(registered).toHaveLength(1);
    expect(registered[0]?.queueName).toBe(ANALYZE_MATCH_QUEUE);
    expect(registered[0]?.queueName).not.toBe(EXTRACT_CV_QUEUE);
    expect(registered[0]?.options.concurrency).toBe(2);
    expect(registered[0]?.options.lockDuration).toBe(
      45_000 + MATCH_LOCK_DURATION_MARGIN_MS,
    );
  });

  it('keeps lockDuration above the worker timeout', () => {
    expect(matchLockDurationFor(60_000)).toBe(75_000);
  });

  it('ignores a job whose data is not the contract', async () => {
    const c = consumer();
    c.onModuleInit();
    await expect(c.handle(jobOf({ analysisId: ANALYSIS_ID }))).resolves.toBeUndefined();
    expect(externalSends).toBe(0);
  });

  it('lets a transient failure through so attempts:1 can mark failed', async () => {
    const clock = new MovableClock();
    analyses.clock = clock;
    const useCase = new AnalyzeMatchUseCase(
      analyses,
      new InMemoryCvTextReader().with(CV_ID, USER_ID),
      new InMemoryJobReader().with(sampleJob()),
      new InMemoryAiContextReader(),
      (async () => {
        throw new Error('mongo blip');
      }) as RunTaskFn,
      clock,
      { timeoutMs: 60_000, maxAgeMs: 120_000 },
    );
    const c = new AnalyzeMatchConsumer(
      useCase,
      { redisUrl: 'redis://x', concurrency: 1, timeoutMs: 60_000 },
      factory,
    );
    c.onModuleInit();
    await expect(c.handle(jobOf(PAYLOAD))).rejects.toThrow('mongo blip');
  });

  it('El trabajo que no vuelve: onJobFailed leaves failed with internal_error', async () => {
    const c = consumer();
    c.onModuleInit();
    await c.onJobFailed(jobOf(PAYLOAD, 1, 1));
    const saved = await analyses.findById(ANALYSIS_ID);
    expect(saved?.status).toBe('failed');
    expect(saved?.failureCode).toBe('internal_error');
  });

  it('ADR-030 §6 / ADR-031: CV external sends do not grow with redeliveries of the same analysisId', async () => {
    const c = consumer();
    c.onModuleInit();
    await c.handle(jobOf(PAYLOAD));
    expect(externalSends).toBe(1);
    await c.handle(jobOf(PAYLOAD));
    await c.handle(jobOf(PAYLOAD));
    expect(externalSends).toBe(1);
  });
});
