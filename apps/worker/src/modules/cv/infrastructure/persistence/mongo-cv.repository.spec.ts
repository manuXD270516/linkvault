import { randomUUID } from 'node:crypto';
import { CV_TEXT_MAX_CHARS, prepareCvText } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection, type Model } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  CV_DOCUMENTS_COLLECTION,
  CV_DOCUMENT_MODEL_NAME,
  cvDocumentSchema,
  type CvDocumentDocument,
} from './cv.schemas';
import { MongoCvRepository } from './mongo-cv.repository';

// Adaptador Mongo de `CV_REPOSITORY` en el worker (tarea 7.8) contra el MongoMemoryReplSet del preset de
// @linkvault/testing. Lo que se prueba aquí es la **carrera**: la escritura condicionada al estado `pending` es la
// idempotencia de D8, y sin un Mongo de verdad no se demuestra que sea atómica.
//
// Y la invariante que sostiene `complete` en la vista previa: `textChars` tiene que ser exactamente
// `$strLenCP(extractedText)`, incluido el caso del texto recortado.

let connection: Connection;
let cvs: Model<CvDocumentDocument>;
let repository: MongoCvRepository;

const ANA = new mongoose.Types.ObjectId();
const AT = new Date('2026-09-12T10:00:05.000Z');

async function insertCv(
  overrides: Partial<CvDocumentDocument> = {},
): Promise<string> {
  const created = await cvs.create({
    userId: ANA,
    fileType: 'pdf',
    extraction: { status: 'pending', textChars: 0 },
    ...overrides,
  });
  return created._id.toHexString();
}

/** Longitud en code points medida por Mongo, que es lo que usa la vista previa. */
async function storedChars(cvId: string): Promise<number> {
  const [row] = await connection
    .collection(CV_DOCUMENTS_COLLECTION)
    .aggregate<{ length: number }>([
      { $match: { _id: new mongoose.Types.ObjectId(cvId) } },
      {
        $project: {
          length: { $strLenCP: { $ifNull: ['$extractedText', ''] } },
        },
      },
    ])
    .toArray();
  return row?.length ?? -1;
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `cv-worker-${randomUUID()}`,
    })
    .asPromise();
  cvs = connection.model<CvDocumentDocument>(
    CV_DOCUMENT_MODEL_NAME,
    cvDocumentSchema,
  );
  repository = new MongoCvRepository(cvs);
});

afterEach(async () => {
  await connection.collection(CV_DOCUMENTS_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('MongoCvRepository.findById', () => {
  it('reads the CV the job names', async () => {
    const cvId = await insertCv({ fileType: 'docx' });

    await expect(repository.findById(cvId)).resolves.toEqual({
      id: cvId,
      userId: ANA.toHexString(),
      fileType: 'docx',
      status: 'pending',
    });
  });

  it('CV borrado antes de leerse: answers null', async () => {
    await expect(
      repository.findById(new mongoose.Types.ObjectId().toHexString()),
    ).resolves.toBeNull();
  });

  it('answers null for a malformed id instead of throwing a CastError', async () => {
    await expect(repository.findById('no-es-un-id')).resolves.toBeNull();
  });
});

describe('MongoCvRepository.saveExtractedText', () => {
  it('writes the text and its state when the CV is still pending', async () => {
    const cvId = await insertCv();
    const prepared = prepareCvText('Nadia Quispe, ingeniera inventada.');

    await expect(
      repository.saveExtractedText(cvId, { ...prepared, extractedAt: AT }),
    ).resolves.toBe(true);

    const saved = await cvs.findById(cvId).lean().exec();
    expect(saved?.extraction).toMatchObject({
      status: 'extracted',
      textChars: prepared.chars,
      extractedAt: AT,
    });
    expect(saved?.extractedText).toBe(prepared.text);
    expect(saved?.truncated).toBe(false);
  });

  it('Carrera perdida: the losing write modifies nothing', async () => {
    const cvId = await insertCv();
    const first = prepareCvText('a'.repeat(200));
    await repository.saveExtractedText(cvId, { ...first, extractedAt: AT });

    const second = prepareCvText('b'.repeat(200));
    await expect(
      repository.saveExtractedText(cvId, { ...second, extractedAt: AT }),
    ).resolves.toBe(false);

    const saved = await cvs.findById(cvId).lean().exec();
    expect(saved?.extractedText).toBe(first.text);
  });

  it('answers false for a CV that no longer exists', async () => {
    await expect(
      repository.saveExtractedText(new mongoose.Types.ObjectId().toHexString(), {
        text: 'hola',
        chars: 4,
        truncated: false,
        extractedAt: AT,
      }),
    ).resolves.toBe(false);
  });

  it('keeps textChars equal to the length Mongo measures', async () => {
    const cvId = await insertCv();
    const prepared = prepareCvText(`  ${'palabra '.repeat(40)}  `);

    await repository.saveExtractedText(cvId, { ...prepared, extractedAt: AT });

    const saved = await cvs.findById(cvId).lean().exec();
    await expect(storedChars(cvId)).resolves.toBe(
      saved?.extraction.textChars ?? -1,
    );
  });

  it('Texto larguísimo: keeps the invariant with the trimmed text too', async () => {
    const cvId = await insertCv();
    const prepared = prepareCvText('a'.repeat(CV_TEXT_MAX_CHARS + 500));

    await repository.saveExtractedText(cvId, { ...prepared, extractedAt: AT });

    const saved = await cvs.findById(cvId).lean().exec();
    expect(saved?.truncated).toBe(true);
    expect(saved?.extraction.textChars).toBe(CV_TEXT_MAX_CHARS);
    await expect(storedChars(cvId)).resolves.toBe(CV_TEXT_MAX_CHARS);
  });

  it('keeps the invariant with characters outside the basic plane', async () => {
    const cvId = await insertCv();
    const prepared = prepareCvText(`${'\u{1F600}'.repeat(60)} texto`);

    await repository.saveExtractedText(cvId, { ...prepared, extractedAt: AT });

    const saved = await cvs.findById(cvId).lean().exec();
    await expect(storedChars(cvId)).resolves.toBe(
      saved?.extraction.textChars ?? -1,
    );
  });
});

describe('MongoCvRepository.saveFailure', () => {
  it('writes the reason when the CV is still pending', async () => {
    const cvId = await insertCv();

    await expect(
      repository.saveFailure(cvId, 'unreadable_file', AT),
    ).resolves.toBe(true);

    const saved = await cvs.findById(cvId).lean().exec();
    expect(saved?.extraction).toMatchObject({
      status: 'failed',
      failureReason: 'unreadable_file',
      textChars: 0,
    });
    expect(saved?.extractedText).toBeUndefined();
  });

  it('Ya extraído: does not overwrite a CV that is no longer pending', async () => {
    const cvId = await insertCv();
    const prepared = prepareCvText('c'.repeat(200));
    await repository.saveExtractedText(cvId, { ...prepared, extractedAt: AT });

    await expect(
      repository.saveFailure(cvId, 'internal_error', AT),
    ).resolves.toBe(false);

    const saved = await cvs.findById(cvId).lean().exec();
    expect(saved?.extraction.status).toBe('extracted');
  });

  it('touches nothing but the extraction', async () => {
    const cvId = await insertCv();
    await connection
      .collection(CV_DOCUMENTS_COLLECTION)
      .updateOne(
        { _id: new mongoose.Types.ObjectId(cvId) },
        { $set: { fileName: 'CV_backend.pdf', version: 3, isDefault: true } },
      );

    await repository.saveFailure(cvId, 'no_text', AT);

    const raw = await connection
      .collection(CV_DOCUMENTS_COLLECTION)
      .findOne({ _id: new mongoose.Types.ObjectId(cvId) });
    expect(raw).toMatchObject({
      fileName: 'CV_backend.pdf',
      version: 3,
      isDefault: true,
    });
  });
});
