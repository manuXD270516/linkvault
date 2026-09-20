import { CV_TEXT_PREVIEW_CHARS } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { CvNotFound, TooManyCvAttempts } from '../domain/errors';
import { CvAnalysisCounts } from './cv-analysis-counts';
import { DeleteCv } from './delete-cv.usecase';
import { GetCvTextPreview } from './get-cv-text-preview.usecase';
import { ListMyCvs } from './list-my-cvs.usecase';
import { SetDefaultCv } from './set-default-cv.usecase';
import {
  InMemoryCvFileStore,
  InMemoryCvLimiter,
  InMemoryCvRepository,
  MovableClock,
} from './testing/cv-test-doubles';
import { UploadCv } from './upload-cv.usecase';

// Los cuatro casos de uso de lectura y edición de `cv`, sobre los dobles. Comparten fixture porque todos parten de lo
// mismo: una persona con CV guardados y otra que no debería ver ninguno.

const ANA = '66e9a0000000000000000a01';
const BETO = '66e9a0000000000000000b01';

let repository: InMemoryCvRepository;
let limiter: InMemoryCvLimiter;
let clock: MovableClock;
let analysisCounts: CvAnalysisCounts;
let upload: UploadCv;
let list: ListMyCvs;
let setDefault: SetDefaultCv;
let remove: DeleteCv;
let preview: GetCvTextPreview;

beforeEach(() => {
  repository = new InMemoryCvRepository();
  limiter = new InMemoryCvLimiter();
  clock = new MovableClock();
  analysisCounts = new CvAnalysisCounts();
  upload = new UploadCv(repository, new InMemoryCvFileStore(), limiter, clock);
  list = new ListMyCvs(repository, analysisCounts);
  setDefault = new SetDefaultCv(repository, analysisCounts);
  remove = new DeleteCv(repository, analysisCounts);
  preview = new GetCvTextPreview(repository, limiter);
});

async function uploadOne(userId: string, fileName = 'CV.pdf') {
  const saved = await upload.execute(userId, () =>
    Promise.resolve({
      fileName,
      fileType: 'pdf' as const,
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    }),
  );
  clock.advance(1000);
  return saved;
}

describe('ListMyCvs', () => {
  it('Lista con tres versiones, de la más reciente a la más antigua', async () => {
    const first = await uploadOne(ANA);
    const second = await uploadOne(ANA);
    const third = await uploadOne(ANA);

    const { items } = await list.execute(ANA);

    expect(items.map((cv) => cv.id)).toEqual([third.id, second.id, first.id]);
  });

  it('Lista vacía', async () => {
    await expect(list.execute(BETO)).resolves.toEqual({ items: [] });
  });

  it('La lista es solo mía', async () => {
    await uploadOne(ANA);
    const his = await uploadOne(BETO);

    const { items } = await list.execute(BETO);

    expect(items.map((cv) => cv.id)).toEqual([his.id]);
  });

  it('el texto no viaja', async () => {
    const saved = await uploadOne(ANA);
    repository.withExtractedText(saved.id, 'texto inventado de un CV');

    const { items } = await list.execute(ANA);

    expect(Object.keys(items[0] ?? {})).not.toContain('extractedText');
    expect(JSON.stringify(items)).not.toContain('texto inventado');
  });
});

describe('SetDefaultCv', () => {
  it('Volver a la anterior', async () => {
    const first = await uploadOne(ANA);
    await uploadOne(ANA);

    const { items } = await setDefault.execute(first.id, ANA);

    expect(items.filter((cv) => cv.isDefault).map((cv) => cv.id)).toEqual([
      first.id,
    ]);
  });

  it('Marcar el que ya lo es', async () => {
    const only = await uploadOne(ANA);

    const { items } = await setDefault.execute(only.id, ANA);

    expect(items.filter((cv) => cv.isDefault).map((cv) => cv.id)).toEqual([
      only.id,
    ]);
  });

  it('Marcar uno en failed', async () => {
    const failed = await uploadOne(ANA);
    repository.withExtraction(failed.id, {
      status: 'failed',
      failureReason: 'no_text',
      textChars: 0,
    });
    await uploadOne(ANA);

    const { items } = await setDefault.execute(failed.id, ANA);

    expect(items.find((cv) => cv.isDefault)?.id).toBe(failed.id);
  });

  it('El CV de otra persona', async () => {
    const mine = await uploadOne(ANA);

    await expect(setDefault.execute(mine.id, BETO)).rejects.toBeInstanceOf(
      CvNotFound,
    );
  });

  it('answers the same 404 for a malformed id', async () => {
    await expect(setDefault.execute('no-es-un-id', ANA)).rejects.toBeInstanceOf(
      CvNotFound,
    );
  });
});

describe('DeleteCv', () => {
  it('Borrar el marcado promueve al más reciente de los que quedan', async () => {
    const first = await uploadOne(ANA);
    const second = await uploadOne(ANA);
    const third = await uploadOne(ANA);

    const { items } = await remove.execute(third.id, ANA);

    expect(items.map((cv) => cv.id)).toEqual([second.id, first.id]);
    expect(items.find((cv) => cv.isDefault)?.id).toBe(second.id);
  });

  it('Borrar el último deja la lista vacía', async () => {
    const only = await uploadOne(ANA);

    await expect(remove.execute(only.id, ANA)).resolves.toEqual({ items: [] });
  });

  it('Borrar dos veces', async () => {
    const only = await uploadOne(ANA);
    await remove.execute(only.id, ANA);

    await expect(remove.execute(only.id, ANA)).rejects.toBeInstanceOf(
      CvNotFound,
    );
  });

  it('El evento queda pendiente', async () => {
    const only = await uploadOne(ANA);

    await remove.execute(only.id, ANA);

    expect(repository.appendedEvents.at(-1)).toEqual({
      type: 'CvDeleted.v1',
      payload: { cvId: only.id, userId: ANA },
    });
  });
});

describe('GetCvTextPreview', () => {
  it('Ver lo leído', async () => {
    const saved = await uploadOne(ANA);
    repository.withExtractedText(saved.id, `${'a'.repeat(8000)} final`);

    const body = await preview.execute(saved.id, ANA);

    expect(body.status).toBe('extracted');
    expect(body.chars).toBeLessThanOrEqual(CV_TEXT_PREVIEW_CHARS);
    expect(body.complete).toBe(false);
  });

  it('Un CV corto se ve entero', async () => {
    const saved = await uploadOne(ANA);
    repository.withExtractedText(saved.id, 'b'.repeat(900));

    const body = await preview.execute(saved.id, ANA);

    expect(body).toEqual({
      status: 'extracted',
      text: 'b'.repeat(900),
      chars: 900,
      complete: true,
    });
  });

  it('Justo 2.000 caracteres', async () => {
    const exact = await uploadOne(ANA);
    repository.withExtractedText(exact.id, 'c'.repeat(CV_TEXT_PREVIEW_CHARS));
    const longer = await uploadOne(ANA);
    repository.withExtractedText(longer.id, 'd'.repeat(50_000));

    await expect(preview.execute(exact.id, ANA)).resolves.toMatchObject({
      chars: CV_TEXT_PREVIEW_CHARS,
      complete: true,
    });
    await expect(preview.execute(longer.id, ANA)).resolves.toMatchObject({
      chars: CV_TEXT_PREVIEW_CHARS,
      complete: false,
    });
  });

  it('Todavía no hay texto', async () => {
    const saved = await uploadOne(ANA);

    await expect(preview.execute(saved.id, ANA)).resolves.toEqual({
      status: 'pending',
      text: '',
      chars: 0,
      complete: false,
    });
  });

  it('Un CV que no se pudo leer se distingue de uno en pending', async () => {
    const saved = await uploadOne(ANA);
    repository.withExtraction(saved.id, {
      status: 'failed',
      failureReason: 'unreadable_file',
      textChars: 0,
    });

    const body = await preview.execute(saved.id, ANA);

    expect(body.status).toBe('failed');
    expect(body.text).toBe('');
  });

  it('El CV de otra persona', async () => {
    const mine = await uploadOne(ANA);

    await expect(preview.execute(mine.id, BETO)).rejects.toBeInstanceOf(
      CvNotFound,
    );
  });

  it('spends its own counter, and answers 429 with its wait when it runs out', async () => {
    const saved = await uploadOne(ANA);
    limiter.allow('text-preview', 1);
    await preview.execute(saved.id, ANA);

    const second = preview.execute(saved.id, ANA);

    await expect(second).rejects.toBeInstanceOf(TooManyCvAttempts);
    await expect(second).rejects.toMatchObject({ retryAfterSeconds: 900 });
    // Su ventana es suya: agotarla no toca la de subidas.
    expect(limiter.countOf({ kind: 'upload', userId: ANA })).toBe(1);
  });

  it('El contador de vistas previas caído: the text still comes back', async () => {
    const saved = await uploadOne(ANA);
    repository.withExtractedText(saved.id, 'texto corto');
    limiter.down = true;

    await expect(preview.execute(saved.id, ANA)).resolves.toMatchObject({
      text: 'texto corto',
    });
  });
});
