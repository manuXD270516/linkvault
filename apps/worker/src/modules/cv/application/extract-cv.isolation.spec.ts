import { cvFileKey } from '@linkvault/shared';
import type { Job } from 'bullmq';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CvExtractionMachineryError } from '../infrastructure/isolation/cv-extraction-machinery.error';
import { IsolatedCvTextExtractor } from '../infrastructure/isolation/isolated-cv-text-extractor';
import {
  ChildScripts,
  runnerFor,
} from '../infrastructure/isolation/isolation-test-kit';
import { ExtractCvConsumer } from '../infrastructure/queue/extract-cv.consumer';
import type { WorkerHandle } from '../infrastructure/queue/worker-factory';
import { ExtractCvUseCase } from './extract-cv.usecase';
import {
  InMemoryCvFileReader,
  InMemoryCvRepository,
  MovableClock,
} from './testing/cv-test-doubles';

// El caso de uso con el **adaptador real** (proceso hijo de prueba) y el repositorio en memoria (4.4 de
// cv-extract-isolation): qué se reintenta y qué no.

const CV_ID = '66e9a0000000000000000c01';
const USER_ID = '66e9a0000000000000000a01';
const PAYLOAD = { cvId: CV_ID, userId: USER_ID } as const;

const scripts = new ChildScripts();
afterAll(() => {
  scripts.dispose();
});

let repository: InMemoryCvRepository;
let files: InMemoryCvFileReader;

beforeEach(() => {
  repository = new InMemoryCvRepository().withCv(CV_ID, { userId: USER_ID });
  files = new InMemoryCvFileReader();
  files.withObject(cvFileKey(USER_ID, CV_ID), new Uint8Array([0x25, 0x50]));
});

function useCaseFor(
  script: string,
  overrides: Parameters<typeof runnerFor>[2] = {},
) {
  const { runner, logs } = runnerFor(scripts, script, overrides);
  const extractor = new IsolatedCvTextExtractor('pdf', runner);
  const useCase = new ExtractCvUseCase(
    repository,
    files,
    { pdf: extractor, docx: extractor },
    new MovableClock(),
    { timeoutMs: 30_000 },
    { upsert: async () => undefined, delete: async () => undefined },
  );
  return { useCase, logs };
}

function consumerFor(useCase: ExtractCvUseCase): ExtractCvConsumer {
  const handle: WorkerHandle = {
    close: async () => undefined,
    on: () => handle,
  };
  return new ExtractCvConsumer(
    useCase,
    { redisUrl: 'redis://127.0.0.1:1', concurrency: 1, timeoutMs: 30_000 },
    () => handle,
  );
}

const JOB = { id: 'j1', data: PAYLOAD } as unknown as Job;

describe('ExtractCvUseCase with the isolated adapter', () => {
  it('a machinery error throws so the queue retries and leaves the CV pending', async () => {
    const { useCase } = useCaseFor(`${scripts.directory}/does-not-exist.cjs`);

    await expect(useCase.execute(PAYLOAD)).rejects.toBeInstanceOf(
      CvExtractionMachineryError,
    );

    expect(repository.failures.size).toBe(0);
    expect(repository.statusOf(CV_ID)).toBe('pending');
  });

  it('a timeout leaves the CV unreadable and is not retried', async () => {
    const script = scripts.write(`
      await ready();
      await readAll();
      spin(8000);
    `);
    const { useCase } = useCaseFor(script, { contentTimeoutMs: 400 });

    // El consumidor no lanza: el job termina bien y la cola no reintenta.
    await expect(consumerFor(useCase).handle(JOB)).resolves.toBeUndefined();

    expect(repository.failures.get(CV_ID)).toBe('unreadable_file');
  });

  it('a never-ready child on every attempt ends in internal_error', async () => {
    const script = scripts.write(`
      await new Promise((resolve) => setTimeout(resolve, 5000));
    `);
    const { useCase } = useCaseFor(script, { bootTimeoutMs: 250 });
    const consumer = consumerFor(useCase);

    // Los tres intentos del job: cada uno lanza, el CV sigue en `pending` entre ellos.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(consumer.handle(JOB)).rejects.toBeInstanceOf(
        CvExtractionMachineryError,
      );
      expect(repository.statusOf(CV_ID)).toBe('pending');
    }
    // Agotados, el oyente de `failed` marca el CV.
    await consumer.onJobFailed(
      {
        id: 'j1',
        data: PAYLOAD,
        attemptsMade: 3,
        opts: { attempts: 3 },
      } as unknown as Job,
      new CvExtractionMachineryError('boot_timeout'),
    );

    expect(repository.failures.get(CV_ID)).toBe('internal_error');
  });

  it('failedReason carries no child text', async () => {
    const script = scripts.write(`
      await send({ type: 'boot_error', code: 'CANARY-CHILD-MSG' });
      hold();
    `);
    const { useCase, logs } = useCaseFor(script);

    // BullMQ guarda `error.message` en `job.failedReason`.
    const error: unknown = await consumerFor(useCase)
      .handle(JOB)
      .then(
        () => undefined,
        (thrown: unknown) => thrown,
      );

    const failedReason = error instanceof Error ? error.message : '';
    expect(failedReason).toBe('cv extraction machinery failure: protocol');
    expect(failedReason).not.toContain('CANARY');
    expect(logs.all()).not.toContain('CANARY');
  });
});
