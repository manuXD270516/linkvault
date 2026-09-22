import {
  DELETE_CV_FILE_QUEUE,
  ENRICH_LINK_QUEUE,
  EXTRACT_CV_QUEUE,
  cvFileKey,
} from '@linkvault/shared';
import type { Job, WorkerOptions } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteCvFileUseCase } from '../../application/delete-cv-file.usecase';
import { ExtractCvUseCase } from '../../application/extract-cv.usecase';
import {
  InMemoryCvFileReader,
  InMemoryCvRepository,
  MovableClock,
  StubExtractor,
  extractorsOf,
} from '../../application/testing/cv-test-doubles';
import { DeleteCvFileConsumer } from './delete-cv-file.consumer';
import {
  CV_LOCK_DURATION_MARGIN_MS,
  ExtractCvConsumer,
  cvLockDurationFor,
} from './extract-cv.consumer';
import type { WorkerFactory, WorkerHandle } from './worker-factory';

// Los dos consumidores con un `Worker` doble: ningún test abre Redis. Lo que se comprueba es la configuración que sale
// del entorno (cola, concurrencia y `lockDuration`) y qué pasa cuando un job agota sus reintentos.

const CV_ID = '66e9a0000000000000000c01';
const USER_ID = '66e9a0000000000000000a01';
const PAYLOAD = { cvId: CV_ID, userId: USER_ID } as const;
const GOOD_TEXT = 'Nadia Quispe, ingeniera inventada. '.repeat(10);

interface Registered {
  queueName: string;
  processor: (job: Job, token?: string) => Promise<void>;
  options: WorkerOptions;
  failedListeners: ((job: Job | undefined, error: Error) => void)[];
  closed: number;
}

let registered: Registered[];
let repository: InMemoryCvRepository;
let files: InMemoryCvFileReader;
let clock: MovableClock;

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
  attemptsMade = 0,
  attempts = 3,
): Job {
  return { id: 'j1', data, attemptsMade, opts: { attempts } } as unknown as Job;
}

beforeEach(() => {
  registered = [];
  repository = new InMemoryCvRepository();
  files = new InMemoryCvFileReader();
  clock = new MovableClock();
});

function extractConsumer(
  extractor: ConstructorParameters<typeof StubExtractor>[0],
  timeoutMs = 30_000,
): ExtractCvConsumer {
  const useCase = new ExtractCvUseCase(
    repository,
    files,
    extractorsOf(new StubExtractor(extractor)),
    clock,
    { timeoutMs },
    { upsert: async () => undefined, delete: async () => undefined },
  );
  return new ExtractCvConsumer(
    useCase,
    { redisUrl: 'redis://127.0.0.1:1', concurrency: 1, timeoutMs },
    factory,
  );
}

describe('ExtractCvConsumer', () => {
  it('Un CV lento no para los links: registers its own queue, with the concurrency and lock of the configuration', () => {
    // El escenario se cumple aquí y no en un test propio: los links tienen su cola y su consumidor
    // (`enrich-link.consumer.spec`), así que un CV que tarde solo ocupa la concurrencia de `extract-cv`. Que sean dos
    // colas distintas es lo único que hay que sostener, y es lo que se afirma.
    extractConsumer({ kind: 'text', text: GOOD_TEXT }, 45_000).onModuleInit();

    expect(registered).toHaveLength(1);
    expect(registered[0]?.queueName).toBe(EXTRACT_CV_QUEUE);
    expect(registered[0]?.queueName).not.toBe(ENRICH_LINK_QUEUE);
    expect(registered[0]?.options.concurrency).toBe(1);
    expect(registered[0]?.options.lockDuration).toBe(
      45_000 + CV_LOCK_DURATION_MARGIN_MS,
    );
  });

  it('keeps the lock above the deadline, so a slow CV is not re-delivered', () => {
    expect(cvLockDurationFor(30_000)).toBeGreaterThan(30_000);
  });

  it('completes the job when the file cannot be read', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });
    files.withObject(cvFileKey(USER_ID, CV_ID), new Uint8Array([0x25]));
    const consumer = extractConsumer({ kind: 'unreadable_file' });

    await expect(consumer.handle(jobOf(PAYLOAD))).resolves.toBeUndefined();

    expect(repository.failures.get(CV_ID)).toBe('unreadable_file');
  });

  it('lets a transient failure through, so the queue retries it', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });
    files.failure = new Error('ServiceUnavailable');
    const consumer = extractConsumer({ kind: 'text', text: GOOD_TEXT });

    await expect(consumer.handle(jobOf(PAYLOAD))).rejects.toThrow(
      'ServiceUnavailable',
    );
  });

  it('ignores a job whose data is not the contract, instead of retrying forever', async () => {
    const consumer = extractConsumer({ kind: 'text', text: GOOD_TEXT });

    await expect(
      consumer.handle(jobOf({ cvId: CV_ID })),
    ).resolves.toBeUndefined();
    expect(repository.failures.size).toBe(0);
  });

  it('leaves the CV in failed when the retries run out', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });
    const consumer = extractConsumer({ kind: 'text', text: GOOD_TEXT });

    await consumer.onJobFailed(jobOf(PAYLOAD, 3, 3));

    expect(repository.failures.get(CV_ID)).toBe('internal_error');
  });

  it('does not touch the CV while the job still has attempts left', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });
    const consumer = extractConsumer({ kind: 'text', text: GOOD_TEXT });

    await consumer.onJobFailed(jobOf(PAYLOAD, 1, 3));

    expect(repository.failures.size).toBe(0);
    expect(repository.statusOf(CV_ID)).toBe('pending');
  });

  it('attaches its failed listener and closes the worker on shutdown', async () => {
    const consumer = extractConsumer({ kind: 'text', text: GOOD_TEXT });
    consumer.onModuleInit();

    expect(registered[0]?.failedListeners).toHaveLength(1);

    await consumer.onApplicationShutdown();

    expect(registered[0]?.closed).toBe(1);
  });
});

describe('DeleteCvFileConsumer', () => {
  function consumerOf(): DeleteCvFileConsumer {
    return new DeleteCvFileConsumer(
      new DeleteCvFileUseCase(files),
      { redisUrl: 'redis://127.0.0.1:1' },
      factory,
    );
  }

  it('registers the delete queue', () => {
    consumerOf().onModuleInit();

    expect(registered[0]?.queueName).toBe(DELETE_CV_FILE_QUEUE);
    expect(registered[0]?.options.concurrency).toBe(1);
  });

  it('El archivo desaparece: deletes the object with the key of its identifiers', async () => {
    const key = cvFileKey(USER_ID, CV_ID);
    files.withObject(key, new Uint8Array([1]));

    await consumerOf().handle(jobOf(PAYLOAD));

    expect(files.removed).toEqual([key]);
    expect(files.objects.has(key)).toBe(false);
  });

  it('El mismo borrado dos veces: the second one finishes without error', async () => {
    const consumer = consumerOf();
    files.withObject(cvFileKey(USER_ID, CV_ID), new Uint8Array([1]));
    await consumer.handle(jobOf(PAYLOAD));

    await expect(consumer.handle(jobOf(PAYLOAD))).resolves.toBeUndefined();
  });

  it('El almacén no responde: throws, so the deletion is retried', async () => {
    files.failure = new Error('ServiceUnavailable');

    await expect(consumerOf().handle(jobOf(PAYLOAD))).rejects.toThrow(
      'ServiceUnavailable',
    );
  });

  it('ignores a job whose data is not the contract', async () => {
    const remove = vi.spyOn(files, 'remove');

    await expect(
      consumerOf().handle(jobOf({ cvId: CV_ID })),
    ).resolves.toBeUndefined();
    expect(remove).not.toHaveBeenCalled();
  });
});
