import { randomUUID } from 'node:crypto';
import { cvFileKey } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { mongo, type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { duplicateKeyIs } from '../../../infrastructure/mongo/duplicate-key';
import {
  CV_DEFAULT_KEY,
  CV_DOCUMENTS_COLLECTION,
  CV_DOCUMENT_MODEL_NAME,
  CV_VERSION_KEY,
  cvDocumentSchema,
  toCvObjectId,
  toUserObjectId,
  type CvDocumentDocument,
} from './cv.schemas';

// Schema de `cv_documents` (tarea 4.3, D12) contra el MongoMemoryReplSet del preset de @linkvault/testing. Se espera
// `Model.init()` antes de probar los índices.

let connection: Connection;

const now = new Date('2026-09-12T10:00:00.000Z');
const USER_ID = new mongoose.Types.ObjectId();
const OTHER_USER_ID = new mongoose.Types.ObjectId();

function cvDocument(
  overrides: Partial<Omit<CvDocumentDocument, '_id'>> = {},
): Omit<CvDocumentDocument, '_id'> {
  const id = new mongoose.Types.ObjectId();
  return {
    userId: USER_ID,
    fileKey: cvFileKey(USER_ID.toHexString(), id.toHexString()),
    fileName: 'CV_backend.pdf',
    fileType: 'pdf',
    sizeBytes: 319_488,
    version: 1,
    isDefault: true,
    uploadedAt: now,
    extraction: { status: 'pending', textChars: 0 },
    ...overrides,
  };
}

async function writeError(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `cv-schemas-${randomUUID()}` })
    .asPromise();
  connection.model<CvDocumentDocument>(CV_DOCUMENT_MODEL_NAME, cvDocumentSchema);
  await connection.model(CV_DOCUMENT_MODEL_NAME).init();
});

afterEach(async () => {
  await connection.collection(CV_DOCUMENTS_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('cv_documents collection', () => {
  it('declares bufferCommands false and the three indexes of D12', async () => {
    expect(cvDocumentSchema.get('bufferCommands')).toBe(false);
    const indexes = await connection
      .collection(CV_DOCUMENTS_COLLECTION)
      .indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { ...CV_VERSION_KEY }, unique: true }),
    );
    expect(indexes).toContainEqual(
      expect.objectContaining({
        key: { ...CV_DEFAULT_KEY },
        unique: true,
        partialFilterExpression: { isDefault: true },
      }),
    );
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { userId: 1, uploadedAt: -1 } }),
    );
  });

  it.each([
    ['fileKey', 'fileKey'],
    ['fileName', 'fileName'],
    ['fileType', 'fileType'],
    ['sizeBytes', 'sizeBytes'],
    ['version', 'version'],
    ['isDefault', 'isDefault'],
    ['uploadedAt', 'uploadedAt'],
    ['extraction', 'extraction'],
  ])('requires %s', async (_name, field) => {
    const model = connection.model<CvDocumentDocument>(CV_DOCUMENT_MODEL_NAME);
    const document: Record<string, unknown> = { ...cvDocument() };
    delete document[field];

    const error = await writeError(
      model.create(document as unknown as Omit<CvDocumentDocument, '_id'>),
    );

    expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
  });

  it('keeps the extracted text and the truncation mark optional', async () => {
    const model = connection.model<CvDocumentDocument>(CV_DOCUMENT_MODEL_NAME);

    const created = await model.create(cvDocument());

    expect(created.extractedText).toBeUndefined();
    expect(created.truncated).toBeUndefined();
    const withText = await model.create(
      cvDocument({
        version: 2,
        isDefault: false,
        extractedText: 'texto inventado de una persona que no existe',
        truncated: true,
        extraction: { status: 'extracted', textChars: 44, extractedAt: now },
      }),
    );
    expect(withText.truncated).toBe(true);
  });

  it('rejects a field the schema does not declare', async () => {
    const model = connection.model<CvDocumentDocument>(CV_DOCUMENT_MODEL_NAME);

    const created = await model.create({
      ...cvDocument(),
      secretNote: 'nada de esto debería guardarse',
    } as unknown as Omit<CvDocumentDocument, '_id'>);

    expect(
      (created.toObject() as unknown as Record<string, unknown>)['secretNote'],
    ).toBeUndefined();
  });

  it('rejects a second CV with the same version for the same person', async () => {
    const model = connection.model<CvDocumentDocument>(CV_DOCUMENT_MODEL_NAME);
    await model.create(cvDocument({ version: 2, isDefault: false }));

    const error = await writeError(
      model.create(cvDocument({ version: 2, isDefault: false })),
    );

    expect(error).toBeInstanceOf(mongo.MongoServerError);
    expect(duplicateKeyIs(error, CV_VERSION_KEY)).toBe(true);
    expect(duplicateKeyIs(error, CV_DEFAULT_KEY)).toBe(false);
  });

  it('rejects a second CV marked as the default for the same person', async () => {
    const model = connection.model<CvDocumentDocument>(CV_DOCUMENT_MODEL_NAME);
    await model.create(cvDocument({ version: 1, isDefault: true }));

    const error = await writeError(
      model.create(cvDocument({ version: 2, isDefault: true })),
    );

    expect(duplicateKeyIs(error, CV_DEFAULT_KEY)).toBe(true);
    expect(duplicateKeyIs(error, CV_VERSION_KEY)).toBe(false);
  });

  it('lets a person keep several CVs that are not the default', async () => {
    const model = connection.model<CvDocumentDocument>(CV_DOCUMENT_MODEL_NAME);

    await model.create(cvDocument({ version: 1, isDefault: false }));
    await model.create(cvDocument({ version: 2, isDefault: false }));

    await expect(model.countDocuments({ userId: USER_ID })).resolves.toBe(2);
  });

  it('does not mix two people: each one has her own version 1 and her own mark', async () => {
    const model = connection.model<CvDocumentDocument>(CV_DOCUMENT_MODEL_NAME);

    await model.create(cvDocument({ version: 1, isDefault: true }));
    await model.create(
      cvDocument({ userId: OTHER_USER_ID, version: 1, isDefault: true }),
    );

    await expect(model.countDocuments({ isDefault: true })).resolves.toBe(2);
  });
});

describe('the identifier guards', () => {
  it('refuses anything that is not an ObjectId', () => {
    expect(toCvObjectId('no-es-un-id')).toBeNull();
    expect(toUserObjectId('')).toBeNull();
    expect(toCvObjectId(USER_ID.toHexString())?.toHexString()).toBe(
      USER_ID.toHexString(),
    );
  });
});
