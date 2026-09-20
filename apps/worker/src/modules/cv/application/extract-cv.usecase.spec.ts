import { CV_MIN_TEXT_CHARS, cvFileKey } from '@linkvault/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExtractCvUseCase } from './extract-cv.usecase';
import {
  InMemoryCvFileReader,
  InMemoryCvRepository,
  MovableClock,
  StubExtractor,
  extractorsOf,
} from './testing/cv-test-doubles';

// Los cuatro cortes de idempotencia de D8, el plazo y los cuatro desenlaces. Ninguno de los cortes es un error del
// job, y ninguno se reintenta.

const CV_ID = '66e9a0000000000000000c01';
const USER_ID = '66e9a0000000000000000a01';
const KEY = cvFileKey(USER_ID, CV_ID);
const PAYLOAD = { cvId: CV_ID, userId: USER_ID } as const;
const GOOD_TEXT = 'Nadia Quispe, ingeniera inventada. '.repeat(10);

let repository: InMemoryCvRepository;
let files: InMemoryCvFileReader;
let clock: MovableClock;

beforeEach(() => {
  repository = new InMemoryCvRepository();
  files = new InMemoryCvFileReader();
  clock = new MovableClock();
});

function useCaseWith(
  extractor: ConstructorParameters<typeof StubExtractor>[0],
  timeoutMs = 1000,
): ExtractCvUseCase {
  return new ExtractCvUseCase(
    repository,
    files,
    extractorsOf(new StubExtractor(extractor)),
    clock,
    { timeoutMs },
  );
}

describe('ExtractCvUseCase, the four outcomes', () => {
  it('PDF con texto', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });
    files.withObject(KEY, new Uint8Array([0x25]));

    const result = await useCaseWith({ kind: 'text', text: GOOD_TEXT }).execute(
      PAYLOAD,
    );

    expect(result).toEqual({
      kind: 'extracted',
      chars: expect.any(Number) as number,
    });
    expect(repository.texts.get(CV_ID)?.text).toContain('Nadia Quispe');
    expect(repository.texts.get(CV_ID)?.extractedAt).toEqual(clock.now());
  });

  it('PDF escaneado', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });
    files.withObject(KEY, new Uint8Array([0x25]));

    const result = await useCaseWith({
      kind: 'text',
      text: 'a'.repeat(CV_MIN_TEXT_CHARS - 1),
    }).execute(PAYLOAD);

    expect(result).toEqual({ kind: 'failed', reason: 'no_text' });
    expect(repository.failures.get(CV_ID)).toBe('no_text');
  });

  it('Archivo corrupto', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });
    files.withObject(KEY, new Uint8Array([0x25]));

    const result = await useCaseWith({ kind: 'unreadable_file' }).execute(
      PAYLOAD,
    );

    expect(result).toEqual({ kind: 'failed', reason: 'unreadable_file' });
  });

  it('Plazo vencido', async () => {
    vi.useFakeTimers();
    try {
      repository.withCv(CV_ID, { userId: USER_ID });
      files.withObject(KEY, new Uint8Array([0x25]));

      const running = useCaseWith('never', 30_000).execute(PAYLOAD);
      await vi.advanceTimersByTimeAsync(30_001);

      await expect(running).resolves.toEqual({
        kind: 'failed',
        reason: 'unreadable_file',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait for a parser that finished in time', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });
    files.withObject(KEY, new Uint8Array([0x25]));

    const started = Date.now();
    await useCaseWith({ kind: 'text', text: GOOD_TEXT }, 30_000).execute(
      PAYLOAD,
    );

    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('ExtractCvUseCase, the four idempotency cuts', () => {
  it('CV borrado antes de leerse', async () => {
    const result = await useCaseWith({ kind: 'text', text: GOOD_TEXT }).execute(
      PAYLOAD,
    );

    expect(result).toEqual({ kind: 'cv_not_found' });
    expect(repository.texts.size).toBe(0);
    expect(repository.failures.size).toBe(0);
  });

  it('Ya extraído: does not even read the file again', async () => {
    repository.withCv(CV_ID, { userId: USER_ID, status: 'extracted' });
    const read = vi.spyOn(files, 'read');

    const result = await useCaseWith({ kind: 'text', text: GOOD_TEXT }).execute(
      PAYLOAD,
    );

    expect(result).toEqual({ kind: 'already_extracted' });
    expect(read).not.toHaveBeenCalled();
  });

  it('El objeto no está: failed with internal_error, and no retry', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });

    const result = await useCaseWith({ kind: 'text', text: GOOD_TEXT }).execute(
      PAYLOAD,
    );

    expect(result).toEqual({ kind: 'failed', reason: 'internal_error' });
    expect(repository.failures.get(CV_ID)).toBe('internal_error');
  });

  it('El almacén no responde: throws, so the queue retries', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });
    files.failure = new Error('ServiceUnavailable');

    await expect(
      useCaseWith({ kind: 'text', text: GOOD_TEXT }).execute(PAYLOAD),
    ).rejects.toThrow('ServiceUnavailable');
    expect(repository.failures.size).toBe(0);
  });

  it('Carrera perdida: the conditional write changed nothing', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });
    files.withObject(KEY, new Uint8Array([0x25]));
    vi.spyOn(repository, 'saveExtractedText').mockResolvedValueOnce(false);

    const result = await useCaseWith({ kind: 'text', text: GOOD_TEXT }).execute(
      PAYLOAD,
    );

    expect(result).toEqual({ kind: 'lost_race' });
  });

  it('a lost race on the failure write is a lost race too', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });
    files.withObject(KEY, new Uint8Array([0x25]));
    vi.spyOn(repository, 'saveFailure').mockResolvedValueOnce(false);

    const result = await useCaseWith({ kind: 'unreadable_file' }).execute(
      PAYLOAD,
    );

    expect(result).toEqual({ kind: 'lost_race' });
  });

  it('La base no responde: throws instead of swallowing it', async () => {
    repository.readFailure = new Error('mongo is down');

    await expect(
      useCaseWith({ kind: 'text', text: GOOD_TEXT }).execute(PAYLOAD),
    ).rejects.toThrow('mongo is down');
  });

  it('reads the object with the key the API used to save it', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });
    files.withObject(KEY, new Uint8Array([0x25]));
    const read = vi.spyOn(files, 'read');

    await useCaseWith({ kind: 'text', text: GOOD_TEXT }).execute(PAYLOAD);

    expect(read).toHaveBeenCalledWith(KEY);
  });
});

describe('ExtractCvUseCase.markRetriesExhausted', () => {
  it('leaves the CV in failed with internal_error, never pending forever', async () => {
    repository.withCv(CV_ID, { userId: USER_ID });

    await useCaseWith({ kind: 'text', text: GOOD_TEXT }).markRetriesExhausted(
      PAYLOAD,
    );

    expect(repository.failures.get(CV_ID)).toBe('internal_error');
    expect(repository.statusOf(CV_ID)).toBe('failed');
  });

  it('does not touch a CV that another run already resolved', async () => {
    repository.withCv(CV_ID, { userId: USER_ID, status: 'extracted' });

    await useCaseWith({ kind: 'text', text: GOOD_TEXT }).markRetriesExhausted(
      PAYLOAD,
    );

    expect(repository.failures.size).toBe(0);
  });
});
