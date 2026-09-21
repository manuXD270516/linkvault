import { MAX_CV_DOCUMENTS, cvFileKey } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CvFileTooLarge,
  InvalidCvUpload,
  TooManyCvAttempts,
  TooManyCvDocuments,
  UnsupportedCvFile,
} from '../domain/errors';
import { CV_UPLOADS_PER_USER } from '../domain/limits';
import {
  InMemoryCvFileStore,
  InMemoryCvLimiter,
  InMemoryCvRepository,
  MovableClock,
} from './testing/cv-test-doubles';
import { UploadCv, type AcceptedCvFile } from './upload-cv.usecase';

// `UploadCv` en el orden de D7. Lo que estos tests fijan y ningún test por HTTP puede fijar igual de barato: qué
// contador se toca en cada rama, qué se devuelve y qué no, y que una rama que no guarda no deja ni objeto ni evento.

const ANA = '66e9a0000000000000000a01';

let repository: InMemoryCvRepository;
let files: InMemoryCvFileStore;
let limiter: InMemoryCvLimiter;
let clock: MovableClock;
let upload: UploadCv;

const pdf: AcceptedCvFile = {
  fileName: 'CV_backend.pdf',
  fileType: 'pdf',
  bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]),
};

beforeEach(() => {
  repository = new InMemoryCvRepository();
  files = new InMemoryCvFileStore();
  limiter = new InMemoryCvLimiter();
  clock = new MovableClock();
  upload = new UploadCv(repository, files, limiter, clock);
});

/** Lectura que entrega el archivo admitido, como haría el controlador tras pasar la puerta. */
const accepts =
  (file: AcceptedCvFile = pdf) =>
  () =>
    Promise.resolve(file);

/** Lectura que rechaza en la puerta, como haría el controlador al husmear el primer trozo. */
const rejectsWith = (error: Error) => () => Promise.reject(error);

describe('UploadCv, the path that saves', () => {
  it('Primera subida', async () => {
    const saved = await upload.execute(ANA, accepts());

    expect(saved.version).toBe(1);
    expect(saved.isDefault).toBe(true);
    expect(saved.extraction).toEqual({ status: 'pending', textChars: 0 });
    expect(saved.fileName).toBe('CV_backend.pdf');
    expect(saved.sizeBytes).toBe(pdf.bytes.byteLength);
  });

  it('uploads the object with the key of its identifier, and nothing of the name', async () => {
    const saved = await upload.execute(ANA, accepts());

    expect(files.putKeys).toEqual([cvFileKey(ANA, saved.id)]);
    expect(files.putKeys[0]).not.toContain('CV_backend');
  });

  it('Segunda subida se lleva la marca', async () => {
    const first = await upload.execute(ANA, accepts());

    const second = await upload.execute(ANA, accepts());

    expect(second.isDefault).toBe(true);
    expect((await repository.findOwned(first.id, ANA))?.isDefault).toBe(false);
  });

  it('El evento se escribe con el documento', async () => {
    const saved = await upload.execute(ANA, accepts());

    expect(repository.appendedEvents).toEqual([
      { type: 'CvUploaded.v1', payload: { cvId: saved.id, userId: ANA } },
    ]);
  });

  it('La transacción falla: no queda documento', async () => {
    repository.insertFailure = new Error('write conflict');

    await expect(upload.execute(ANA, accepts())).rejects.toThrow(
      'write conflict',
    );

    await expect(repository.listByUser(ANA)).resolves.toEqual([]);
    expect(repository.appendedEvents).toEqual([]);
    expect(limiter.countOf({ kind: 'upload', userId: ANA })).toBe(0);
  });

  it('never returns the text nor the key of the object', async () => {
    const saved = await upload.execute(ANA, accepts());

    expect(Object.keys(saved)).toEqual([
      'id',
      'fileName',
      'fileType',
      'sizeBytes',
      'version',
      'isDefault',
      'uploadedAt',
      'extraction',
      'matchAnalysesCount',
    ]);
    expect(saved.matchAnalysesCount).toBe(0);
  });
});

describe('UploadCv, the paths that save nothing', () => {
  it.each([
    ['an unsupported type', new UnsupportedCvFile()],
    ['a file over the cap', new CvFileTooLarge()],
  ])('counts a rejection and no upload for %s', async (_case, error) => {
    await expect(
      upload.execute(ANA, rejectsWith(error)),
    ).rejects.toBeInstanceOf(error.constructor as new () => Error);

    expect(limiter.countOf({ kind: 'reject', userId: ANA })).toBe(1);
    expect(limiter.countOf({ kind: 'upload', userId: ANA })).toBe(0);
    expect(limiter.refunds).toEqual([]);
    expect(files.putKeys).toEqual([]);
  });

  it('does not count a rejection for a malformed request', async () => {
    // Un formulario sin parte `file` no es un archivo rechazado: no hay nada que contar contra esa ventana.
    await expect(
      upload.execute(ANA, rejectsWith(new InvalidCvUpload())),
    ).rejects.toBeInstanceOf(InvalidCvUpload);

    expect(limiter.countOf({ kind: 'reject', userId: ANA })).toBe(0);
  });

  it('answers 429 when the rejection window runs out', async () => {
    limiter.allow('reject', 1);
    await expect(
      upload.execute(ANA, rejectsWith(new UnsupportedCvFile())),
    ).rejects.toBeInstanceOf(UnsupportedCvFile);

    await expect(
      upload.execute(ANA, rejectsWith(new UnsupportedCvFile())),
    ).rejects.toBeInstanceOf(TooManyCvAttempts);
  });

  it('Sexto CV: answers too_many_cvs and gives the attempt back', async () => {
    for (let i = 0; i < MAX_CV_DOCUMENTS; i += 1) {
      await upload.execute(ANA, accepts());
    }
    const spent = limiter.countOf({ kind: 'upload', userId: ANA });

    await expect(upload.execute(ANA, accepts())).rejects.toBeInstanceOf(
      TooManyCvDocuments,
    );

    expect(limiter.countOf({ kind: 'upload', userId: ANA })).toBe(spent);
    expect(files.putKeys).toHaveLength(MAX_CV_DOCUMENTS);
  });

  it('El almacén no responde: 500, nothing saved and the attempt back', async () => {
    files.failure = new Error('Connection refused');

    await expect(upload.execute(ANA, accepts())).rejects.toThrow(
      'Connection refused',
    );

    await expect(repository.listByUser(ANA)).resolves.toEqual([]);
    expect(repository.appendedEvents).toEqual([]);
    expect(limiter.countOf({ kind: 'upload', userId: ANA })).toBe(0);
    expect(limiter.refunds).toEqual([`cv:upload:${ANA}`]);
  });

  it('Once subidas: the eleventh accepted one is refused with its wait', async () => {
    limiter.allow('upload', CV_UPLOADS_PER_USER);
    for (let i = 0; i < CV_UPLOADS_PER_USER; i += 1) {
      const saved = await upload.execute(ANA, accepts());
      // Borrados intercalados: sin ellos se chocaría antes con el máximo de 5 y nunca se llegaría al contador.
      await repository.remove(saved.id, ANA);
    }

    const eleventh = upload.execute(ANA, accepts());

    await expect(eleventh).rejects.toBeInstanceOf(TooManyCvAttempts);
    await expect(eleventh).rejects.toMatchObject({ retryAfterSeconds: 900 });
  });

  it('a spent upload window never reaches the store', async () => {
    limiter.allow('upload', 0);

    await expect(upload.execute(ANA, accepts())).rejects.toBeInstanceOf(
      TooManyCvAttempts,
    );

    expect(files.putKeys).toEqual([]);
  });

  it('Contador caído: the upload goes through', async () => {
    limiter.down = true;

    await expect(upload.execute(ANA, accepts())).resolves.toMatchObject({
      version: 1,
    });
  });
});
