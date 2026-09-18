import { ENRICH_LINK_QUEUE } from '@linkvault/shared';
import { DelayedError, type Job, type WorkerOptions } from 'bullmq';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type {
  EnrichLinkJob,
  EnrichLinkResult,
  EnrichLinkUseCase,
} from '../../application/enrich-link.usecase';
import {
  EnrichLinkConsumer,
  LOCK_DURATION_MARGIN_MS,
  lockDurationFor,
  type EnrichLinkJobData,
  type EnrichLinkJobHandle,
  type WorkerFactory,
  type WorkerHandle,
} from './enrich-link.consumer';

// Requisito "Consumo del trabajo encolado" (specs/links/enrichment) y D1 y D6 de link-enrichment. El `Worker` es un
// doble: la suite del worker no abre Redis, y lo que se prueba aquí es con qué opciones se crea y qué hace con un job.

const LINK_ID = '68c0f0f0f0f0f0f0f0f0f0f0';
const DEADLINE_MS = 45_000;
const NOW = 1_800_000_000_000;

const OPTIONS = {
  redisUrl: 'redis://127.0.0.1:6379',
  concurrency: 4,
  deadlineMs: DEADLINE_MS,
};

/** Cola de mentira: guarda los jobs y solo los procesa cuando hay un consumidor arrancado. */
class FakeQueue {
  readonly waiting: FakeJob[] = [];
  readonly delayed: { job: FakeJob; until: number }[] = [];
  private processor: ((job: Job, token?: string) => Promise<void>) | null =
    null;
  private failedListener:
    ((job: Job | undefined, error: Error) => void) | null = null;

  readonly created: { queueName: string; options: WorkerOptions }[] = [];

  add(data: EnrichLinkJobData, opts: { attempts?: number } = {}): FakeJob {
    const job = new FakeJob(data, opts, this);
    this.waiting.push(job);
    return job;
  }

  /** Fábrica que este doble entrega al consumidor en lugar de un `Worker` de BullMQ. */
  readonly factory: WorkerFactory = (queueName, processor, options) => {
    this.created.push({ queueName, options });
    this.processor = processor;
    const worker: WorkerHandle = {
      close: () => {
        this.processor = null;
        return Promise.resolve();
      },
      on: (_event, listener) => {
        this.failedListener = listener;
        return worker;
      },
    };
    return worker;
  };

  /** Entrega los jobs que esperan, como haría el `Worker` al arrancar. Sin consumidor no pasa nada. */
  async drain(): Promise<void> {
    if (this.processor === null) return;
    const pending = this.waiting.splice(0, this.waiting.length);
    for (const job of pending) {
      try {
        await this.processor(job as unknown as Job, 'token');
      } catch (error: unknown) {
        job.attemptsMade += 1;
        this.failedListener?.(job as unknown as Job, error as Error);
      }
    }
  }
}

class FakeJob implements EnrichLinkJobHandle {
  readonly id = 'enrich:1';
  attemptsMade = 0;

  constructor(
    public data: EnrichLinkJobData,
    readonly opts: { attempts?: number },
    private readonly queue: FakeQueue,
  ) {}

  updateData(data: EnrichLinkJobData): Promise<void> {
    this.data = data;
    return Promise.resolve();
  }

  moveToDelayed(timestamp: number): Promise<void> {
    this.queue.delayed.push({ job: this, until: timestamp });
    return Promise.resolve();
  }
}

/** Caso de uso de mentira: responde lo que se le diga y anota los jobs que le llegan. */
function useCaseOf(results: EnrichLinkResult[]): EnrichLinkUseCase & {
  executed: EnrichLinkJob[];
  exhausted: EnrichLinkJob[];
} {
  const executed: EnrichLinkJob[] = [];
  const exhausted: EnrichLinkJob[] = [];
  const fallback: EnrichLinkResult = {
    kind: 'done',
    previewStatus: 'enriched',
    previewVersion: 2,
  };
  return {
    executed,
    exhausted,
    execute: (job: EnrichLinkJob) => {
      executed.push(job);
      return Promise.resolve(results.shift() ?? fallback);
    },
    markRetriesExhausted: (job: EnrichLinkJob) => {
      exhausted.push(job);
      return Promise.resolve(fallback);
    },
  } as unknown as EnrichLinkUseCase & {
    executed: EnrichLinkJob[];
    exhausted: EnrichLinkJob[];
  };
}

function consumerOf(
  queue: FakeQueue,
  useCase: ReturnType<typeof useCaseOf>,
): EnrichLinkConsumer {
  return new EnrichLinkConsumer(useCase, OPTIONS, queue.factory, () => NOW);
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

describe('Job consumido', () => {
  it('enriches the link the job names, from its first attempt', async () => {
    const queue = new FakeQueue();
    const useCase = useCaseOf([]);
    consumerOf(queue, useCase).onModuleInit();

    queue.add({ linkId: LINK_ID, previewVersion: 1 });
    await queue.drain();

    expect(useCase.executed).toEqual([
      { linkId: LINK_ID, previewVersion: 1, deferrals: 0 },
    ]);
  });

  it('runs with the configured concurrency and a lock above the link deadline', () => {
    const queue = new FakeQueue();
    consumerOf(queue, useCaseOf([])).onModuleInit();

    expect(queue.created).toHaveLength(1);
    expect(queue.created[0].queueName).toBe(ENRICH_LINK_QUEUE);
    expect(queue.created[0].options.concurrency).toBe(4);
    // Por debajo del plazo del link, BullMQ daría por `stalled` un job que aún trabaja y lo reentregaría.
    expect(queue.created[0].options.lockDuration).toBe(
      DEADLINE_MS + LOCK_DURATION_MARGIN_MS,
    );
    expect(lockDurationFor(DEADLINE_MS)).toBeGreaterThan(DEADLINE_MS);
  });

  it('does not retry a job whose data is not the contract', async () => {
    const queue = new FakeQueue();
    const useCase = useCaseOf([]);
    consumerOf(queue, useCase).onModuleInit();

    queue.add({ linkId: '', previewVersion: 0 } as EnrichLinkJobData);
    await queue.drain();

    expect(useCase.executed).toEqual([]);
    expect(queue.delayed).toEqual([]);
  });

  it('stops consuming when the application shuts down, leaving the work in the queue', async () => {
    const queue = new FakeQueue();
    const useCase = useCaseOf([]);
    const consumer = consumerOf(queue, useCase);
    consumer.onModuleInit();

    await consumer.onApplicationShutdown();

    queue.add({ linkId: LINK_ID, previewVersion: 1 });
    await queue.drain();

    // El trabajo espera al siguiente proceso en lugar de perderse, que es lo mismo que pasaba sin consumidor.
    expect(useCase.executed).toEqual([]);
    expect(queue.waiting).toHaveLength(1);
  });
});

describe('Cola sin consumidor', () => {
  it('leaves the job waiting, and processes it when the worker starts', async () => {
    const queue = new FakeQueue();
    const useCase = useCaseOf([]);
    queue.add({ linkId: LINK_ID, previewVersion: 1 });

    // Sin consumidor arrancado nadie lo toca: el job espera, y su link con él.
    await queue.drain();
    expect(useCase.executed).toEqual([]);
    expect(queue.waiting).toHaveLength(1);

    consumerOf(queue, useCase).onModuleInit();
    await queue.drain();

    expect(useCase.executed).toHaveLength(1);
  });
});

describe('Host ocupado', () => {
  it('sends the job back to the queue with its wait and its deferral count', async () => {
    const queue = new FakeQueue();
    const useCase = useCaseOf([
      { kind: 'deferred', deferrals: 1, waitMs: 2_000 },
    ]);
    consumerOf(queue, useCase).onModuleInit();

    const job = queue.add({ linkId: LINK_ID, previewVersion: 1 });
    await queue.drain();

    expect(queue.delayed).toEqual([{ job, until: NOW + 2_000 }]);
    // El contador viaja en el job: sin él, un host ocupado rebotaría para siempre.
    expect(job.data).toEqual({
      linkId: LINK_ID,
      previewVersion: 1,
      deferrals: 1,
    });
  });

  it('does not count a deferral as a failed attempt', async () => {
    const queue = new FakeQueue();
    const useCase = useCaseOf([
      { kind: 'deferred', deferrals: 1, waitMs: 2_000 },
    ]);
    const consumer = consumerOf(queue, useCase);
    consumer.onModuleInit();
    const job = queue.add({ linkId: LINK_ID, previewVersion: 1 });

    await expect(consumer.handle(job, 'token')).rejects.toBeInstanceOf(
      DelayedError,
    );
    // `DelayedError` es cómo BullMQ sabe que el job no ha terminado, no que haya fallado.
    await consumer.onJobFailed(job as unknown as Job, new DelayedError());
    expect(useCase.exhausted).toEqual([]);
  });
});

describe('Job que agota sus reintentos', () => {
  it('leaves the link failed only when there are no attempts left', async () => {
    const queue = new FakeQueue();
    const useCase = useCaseOf([]);
    const consumer = consumerOf(queue, useCase);
    const job = queue.add(
      { linkId: LINK_ID, previewVersion: 1 },
      { attempts: 3 },
    );

    job.attemptsMade = 2;
    await consumer.onJobFailed(job as unknown as Job, new Error('timeout'));
    expect(useCase.exhausted).toEqual([]);

    job.attemptsMade = 3;
    await consumer.onJobFailed(job as unknown as Job, new Error('timeout'));
    expect(useCase.exhausted).toEqual([
      { linkId: LINK_ID, previewVersion: 1, deferrals: 0 },
    ]);
  });

  it('does nothing without a job to blame', async () => {
    const useCase = useCaseOf([]);
    const consumer = consumerOf(new FakeQueue(), useCase);

    await consumer.onJobFailed(undefined, new Error('la cola se cayó'));

    expect(useCase.exhausted).toEqual([]);
  });
});
