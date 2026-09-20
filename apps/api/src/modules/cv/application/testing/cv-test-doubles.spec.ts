import { CV_TEXT_PREVIEW_CHARS } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryCvFileStore,
  InMemoryCvLimiter,
  InMemoryCvRepository,
  MovableClock,
} from './cv-test-doubles';

// Los dobles se prueban aparte porque son la base de todos los tests de casos de uso: si el repositorio en memoria no
// respeta la correlatividad de la versión o deja dos CV marcados, media suite estaría probando otra cosa.

const ANA = '66e9a0000000000000000a01';
const BETO = '66e9a0000000000000000b01';

let clock: MovableClock;
let repository: InMemoryCvRepository;

beforeEach(() => {
  clock = new MovableClock();
  repository = new InMemoryCvRepository();
});

async function upload(userId: string, fileName = 'CV.pdf') {
  const id = repository.nextId();
  const stored = await repository.insertAsDefault({
    id,
    userId,
    fileKey: `${userId}/${id}`,
    fileName,
    fileType: 'pdf',
    sizeBytes: 1024,
    uploadedAt: clock.now(),
  });
  clock.advance(1000);
  return stored;
}

describe('InMemoryCvRepository', () => {
  it('numbers the versions without reusing the ones already given out', async () => {
    const first = await upload(ANA);
    const second = await upload(ANA);
    await repository.remove(second.id, ANA);

    const third = await upload(ANA);

    expect([first.version, second.version, third.version]).toEqual([1, 2, 3]);
  });

  it('gives the mark to the newest upload, and to only one', async () => {
    await upload(ANA);
    const second = await upload(ANA);

    const list = await repository.listByUser(ANA);

    expect(list.filter((cv) => cv.isDefault).map((cv) => cv.id)).toEqual([
      second.id,
    ]);
  });

  it('lists newest first and only what belongs to the person asking', async () => {
    const first = await upload(ANA);
    const second = await upload(ANA);
    await upload(BETO);

    expect((await repository.listByUser(ANA)).map((cv) => cv.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it('answers null for another person, an unknown CV and a malformed id', async () => {
    const mine = await upload(ANA);

    await expect(repository.findOwned(mine.id, BETO)).resolves.toBeNull();
    await expect(
      repository.findOwned('66e9a0000000000000009999', ANA),
    ).resolves.toBeNull();
    await expect(repository.findOwned('no-es-un-id', ANA)).resolves.toBeNull();
  });

  it('promotes the most recent of those left when the marked one goes', async () => {
    const first = await upload(ANA);
    const second = await upload(ANA);

    await repository.remove(second.id, ANA);

    expect((await repository.findOwned(first.id, ANA))?.isDefault).toBe(true);
  });

  it('writes the upload and deletion events in the outbox', async () => {
    const cv = await upload(ANA);

    await repository.remove(cv.id, ANA);

    expect(repository.appendedEvents).toEqual([
      { type: 'CvUploaded.v1', payload: { cvId: cv.id, userId: ANA } },
      { type: 'CvDeleted.v1', payload: { cvId: cv.id, userId: ANA } },
    ]);
  });

  it('never returns the extracted text in a listing', async () => {
    const cv = await upload(ANA);
    repository.withExtractedText(cv.id, 'texto inventado de un CV de prueba');

    const [listed] = await repository.listByUser(ANA);

    expect(Object.keys(listed ?? {})).not.toContain('extractedText');
    expect(listed?.extraction.textChars).toBe(34);
  });

  it('answers the preview with its prefix and whether that was all of it', async () => {
    const cv = await upload(ANA);
    repository.withExtractedText(cv.id, 'a'.repeat(CV_TEXT_PREVIEW_CHARS + 50));

    const preview = await repository.textPreviewOf(cv.id, ANA);

    expect(preview?.chars).toBe(CV_TEXT_PREVIEW_CHARS);
    expect(preview?.complete).toBe(false);
    expect(preview?.status).toBe('extracted');
  });
});

describe('InMemoryCvFileStore', () => {
  it('records the key it was given and can pretend to be down', async () => {
    const store = new InMemoryCvFileStore();

    await store.put('u1/c1', new Uint8Array([1, 2]), 'pdf');
    store.failure = new Error('Connection refused');

    await expect(
      store.put('u1/c2', new Uint8Array([3]), 'docx'),
    ).rejects.toThrow();
    expect(store.putKeys).toEqual(['u1/c1', 'u1/c2']);
    expect(store.objects.has('u1/c2')).toBe(false);
  });
});

describe('InMemoryCvLimiter', () => {
  it('keeps the three keys apart', async () => {
    const limiter = new InMemoryCvLimiter().allow('upload', 1);

    await limiter.consume({ kind: 'upload', userId: ANA });
    const second = await limiter.consume({ kind: 'upload', userId: ANA });
    const preview = await limiter.consume({ kind: 'text-preview', userId: ANA });

    expect(second.allowed).toBe(false);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
    expect(preview.allowed).toBe(true);
  });

  it('lets everything through when it is down', async () => {
    const limiter = new InMemoryCvLimiter().allow('reject', 0);
    limiter.down = true;

    await expect(
      limiter.consume({ kind: 'reject', userId: ANA }),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it('gives an upload attempt back', async () => {
    const limiter = new InMemoryCvLimiter();
    await limiter.consume({ kind: 'upload', userId: ANA });

    await limiter.refund({ kind: 'upload', userId: ANA });

    expect(limiter.countOf({ kind: 'upload', userId: ANA })).toBe(0);
    expect(limiter.refunds).toEqual([`cv:upload:${ANA}`]);
  });
});
