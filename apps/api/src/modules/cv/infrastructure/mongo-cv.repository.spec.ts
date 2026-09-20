import { randomUUID } from 'node:crypto';
import {
  CV_TEXT_MAX_CHARS,
  CV_TEXT_PREVIEW_CHARS,
  MAX_CV_DOCUMENTS,
  cvFileKey,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type ClientSession, type Connection } from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  OUTBOX_EVENTS_COLLECTION,
  OUTBOX_EVENT_MODEL_NAME,
  outboxEventSchema,
  type OutboxEventDocument,
} from '../../../infrastructure/outbox/outbox-event.schemas';
import type {
  Outbox,
  OutboxEvent,
} from '../../../infrastructure/outbox/outbox.port';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import type { NewCvDocument } from '../application/ports/cv-repository.port';
import { TooManyCvDocuments } from '../domain/errors';
import {
  CV_DOCUMENTS_COLLECTION,
  CV_DOCUMENT_MODEL_NAME,
  CV_VERSION_COUNTERS_COLLECTION,
  CV_VERSION_COUNTER_MODEL_NAME,
  cvDocumentSchema,
  cvVersionCounterSchema,
  type CvDocumentDocument,
  type CvVersionCounterDocument,
} from './cv.schemas';
import {
  MongoCvRepository,
  textPreviewProjection,
} from './mongo-cv.repository';

// Repositorio de `cv` contra el MongoMemoryReplSet del preset de @linkvault/testing (tareas 4.5 a 4.9). Lo que se
// comprueba aquí y en ningún otro sitio: la correlatividad de la versión sin reutilizar huecos, que el evento sale de
// la misma transacción que el documento, que la carrera de dos subidas deja un solo marcado y ningún `500`, y que
// ninguna lectura se trae el texto extraído salvo la vista previa, que trae solo su prefijo.

let connection: Connection;
let repository: MongoCvRepository;
let outbox: RecordingOutbox;

const now = new Date('2026-09-12T10:00:00.000Z');
const ANA = new mongoose.Types.ObjectId().toHexString();
const BETO = new mongoose.Types.ObjectId().toHexString();

/** Outbox real en lo que importa: escribe en `outbox_events` dentro de la sesión que le dan. */
class RecordingOutbox implements Outbox {
  readonly appended: OutboxEvent[] = [];

  constructor(private readonly events: Connection) {}

  async append(event: OutboxEvent, session: TransactionSession): Promise<void> {
    this.appended.push(event);
    await this.events
      .model<OutboxEventDocument>(OUTBOX_EVENT_MODEL_NAME)
      .create(
        [
          {
            type: event.type,
            payload: event.payload,
            createdAt: now,
            publishedAt: null,
            failedAt: null,
            attempts: 0,
            nextAttemptAt: now,
          },
        ],
        { session: session as ClientSession },
      );
  }
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `cv-repo-${randomUUID()}` })
    .asPromise();
  connection.model<CvDocumentDocument>(CV_DOCUMENT_MODEL_NAME, cvDocumentSchema);
  connection.model<CvVersionCounterDocument>(
    CV_VERSION_COUNTER_MODEL_NAME,
    cvVersionCounterSchema,
  );
  connection.model<OutboxEventDocument>(
    OUTBOX_EVENT_MODEL_NAME,
    outboxEventSchema,
  );
  await connection.model(CV_DOCUMENT_MODEL_NAME).init();
});

beforeEach(() => {
  outbox = new RecordingOutbox(connection);
  repository = new MongoCvRepository(connection, outbox);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await connection.collection(CV_DOCUMENTS_COLLECTION).deleteMany({});
  await connection.collection(CV_VERSION_COUNTERS_COLLECTION).deleteMany({});
  await connection.collection(OUTBOX_EVENTS_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

function newCv(
  userId: string,
  overrides: Partial<NewCvDocument> = {},
): NewCvDocument {
  const id = repository.nextId();
  return {
    id,
    userId,
    fileKey: cvFileKey(userId, id),
    fileName: 'CV_backend.pdf',
    fileType: 'pdf',
    sizeBytes: 319_488,
    uploadedAt: now,
    ...overrides,
  };
}

/** Sube un CV avanzando la fecha, para que el orden del listado sea inequívoco. */
let uploadedAt = now;
async function upload(userId: string, overrides: Partial<NewCvDocument> = {}) {
  uploadedAt = new Date(uploadedAt.getTime() + 1000);
  return await repository.insertAsDefault(
    newCv(userId, { uploadedAt, ...overrides }),
  );
}

function pendingEvents(): Promise<OutboxEventDocument[]> {
  return connection
    .collection<OutboxEventDocument>(OUTBOX_EVENTS_COLLECTION)
    .find({ publishedAt: null })
    .toArray();
}

describe('MongoCvRepository.insertAsDefault', () => {
  it('Primera subida', async () => {
    const saved = await upload(ANA);

    expect(saved.version).toBe(1);
    expect(saved.isDefault).toBe(true);
    expect(saved.extraction).toEqual({ status: 'pending', textChars: 0 });
  });

  it('Segunda subida', async () => {
    const first = await upload(ANA);

    const second = await upload(ANA);

    expect(second.version).toBe(2);
    expect((await repository.findOwned(first.id, ANA))?.isDefault).toBe(false);
  });

  it('Los números no se reutilizan', async () => {
    await upload(ANA);
    await upload(ANA);
    const third = await upload(ANA);
    await repository.remove(third.id, ANA);

    const fourth = await upload(ANA);

    expect(fourth.version).toBe(4);
  });

  it('writes the CV and its event in the same transaction', async () => {
    const saved = await upload(ANA);

    const events = await pendingEvents();
    expect(events.map((event) => event.type)).toEqual(['CvUploaded.v1']);
    expect(events[0]?.payload).toEqual({ cvId: saved.id, userId: ANA });
  });

  it('leaves neither CV nor event when the transaction cannot commit', async () => {
    vi.spyOn(outbox, 'append').mockRejectedValueOnce(new Error('mongo is down'));

    await expect(upload(ANA)).rejects.toThrow('mongo is down');

    await expect(repository.countOf(ANA)).resolves.toBe(0);
    await expect(pendingEvents()).resolves.toEqual([]);
  });

  it('Sexto CV: the transaction is the truth about the cap', async () => {
    for (let i = 0; i < MAX_CV_DOCUMENTS; i += 1) {
      await upload(ANA);
    }

    await expect(upload(ANA)).rejects.toBeInstanceOf(TooManyCvDocuments);
    await expect(repository.countOf(ANA)).resolves.toBe(MAX_CV_DOCUMENTS);
  });

  it('Dos subidas a la vez', async () => {
    await upload(ANA);

    const [second, third] = await Promise.all([
      upload(ANA),
      upload(ANA),
    ]);

    expect([second.version, third.version].sort()).toEqual([2, 3]);
    const list = await repository.listByUser(ANA);
    expect(list.filter((cv) => cv.isDefault)).toHaveLength(1);
  });

  it('Dos subidas a la vez se disputan la marca, y ninguna responde 500', async () => {
    // Tres a la vez: el índice parcial rechaza a la que llega tarde y el bucle rehace apagado e inserción.
    const results = await Promise.all([
      upload(ANA),
      upload(ANA),
      upload(ANA),
    ]);

    expect(results).toHaveLength(3);
    const list = await repository.listByUser(ANA);
    expect(list.filter((cv) => cv.isDefault)).toHaveLength(1);
    expect(new Set(list.map((cv) => cv.version)).size).toBe(list.length);
  });
});

describe('MongoCvRepository reads', () => {
  it('Lista con tres versiones, newest first and only mine', async () => {
    const first = await upload(ANA);
    const second = await upload(ANA);
    const third = await upload(ANA);
    await upload(BETO);

    expect((await repository.listByUser(ANA)).map((cv) => cv.id)).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
  });

  it('Lista vacía', async () => {
    await expect(repository.listByUser(BETO)).resolves.toEqual([]);
  });

  it.each([
    ['another person', (id: string) => repository.findOwned(id, BETO)],
    [
      'an unknown CV',
      () => repository.findOwned(new mongoose.Types.ObjectId().toHexString(), ANA),
    ],
    ['a malformed id', () => repository.findOwned('no-es-un-id', ANA)],
  ])('answers null for %s', async (_case, read) => {
    const mine = await upload(ANA);

    await expect(read(mine.id)).resolves.toBeNull();
  });

  it('El listado no arrastra el texto', async () => {
    const saved = await upload(ANA);
    await connection
      .collection(CV_DOCUMENTS_COLLECTION)
      .updateOne(
        { _id: new mongoose.Types.ObjectId(saved.id) },
        {
          $set: {
            extractedText: 'texto inventado de un CV de prueba',
            truncated: true,
            'extraction.status': 'extracted',
            'extraction.textChars': 34,
          },
        },
      );

    const [listed] = await repository.listByUser(ANA);
    const found = await repository.findOwned(saved.id, ANA);

    for (const document of [listed, found]) {
      const keys = Object.keys(document ?? {});
      expect(keys).not.toContain('extractedText');
      expect(keys).not.toContain('truncated');
      expect(keys).not.toContain('fileKey');
    }
  });
});

describe('MongoCvRepository.setDefault', () => {
  it('Volver a la anterior', async () => {
    const first = await upload(ANA);
    await upload(ANA);

    await expect(repository.setDefault(first.id, ANA)).resolves.toBe(true);

    const list = await repository.listByUser(ANA);
    expect(list.filter((cv) => cv.isDefault).map((cv) => cv.id)).toEqual([
      first.id,
    ]);
  });

  it('Marcar el que ya lo es', async () => {
    const only = await upload(ANA);

    await expect(repository.setDefault(only.id, ANA)).resolves.toBe(true);

    expect((await repository.findOwned(only.id, ANA))?.isDefault).toBe(true);
  });

  it('Nunca dos marcados', async () => {
    const first = await upload(ANA);
    const second = await upload(ANA);

    await Promise.all([
      repository.setDefault(first.id, ANA),
      repository.setDefault(second.id, ANA),
    ]);

    const list = await repository.listByUser(ANA);
    expect(list.filter((cv) => cv.isDefault)).toHaveLength(1);
  });

  it('answers false for the CV of another person', async () => {
    const mine = await upload(ANA);

    await expect(repository.setDefault(mine.id, BETO)).resolves.toBe(false);
    expect((await repository.findOwned(mine.id, ANA))?.isDefault).toBe(true);
  });
});

describe('MongoCvRepository.remove', () => {
  it('Borrar el marcado promotes the most recent of those left', async () => {
    const first = await upload(ANA);
    const second = await upload(ANA);
    const third = await upload(ANA);

    await expect(repository.remove(third.id, ANA)).resolves.toBe(true);

    expect((await repository.findOwned(second.id, ANA))?.isDefault).toBe(true);
    expect((await repository.findOwned(first.id, ANA))?.isDefault).toBe(false);
  });

  it('Borrar el último leaves nothing and no mark', async () => {
    const only = await upload(ANA);

    await repository.remove(only.id, ANA);

    await expect(repository.listByUser(ANA)).resolves.toEqual([]);
  });

  it('Borrar lo ajeno changes nothing', async () => {
    const mine = await upload(ANA);

    await expect(repository.remove(mine.id, BETO)).resolves.toBe(false);
    await expect(repository.countOf(ANA)).resolves.toBe(1);
  });

  it('leaves the deletion event pending in the same transaction', async () => {
    const saved = await upload(ANA);
    await connection.collection(OUTBOX_EVENTS_COLLECTION).deleteMany({});

    await repository.remove(saved.id, ANA);

    const events = await pendingEvents();
    expect(events.map((event) => event.type)).toEqual(['CvDeleted.v1']);
    expect(events[0]?.payload).toEqual({ cvId: saved.id, userId: ANA });
  });
});

describe('MongoCvRepository.textPreviewOf', () => {
  async function withText(text: string, status = 'extracted') {
    const saved = await upload(ANA);
    await connection
      .collection(CV_DOCUMENTS_COLLECTION)
      .updateOne(
        { _id: new mongoose.Types.ObjectId(saved.id) },
        {
          $set: {
            extractedText: text,
            'extraction.status': status,
            'extraction.textChars': [...text].length,
          },
        },
      );
    return saved;
  }

  it('Ver lo leído: a long text comes back cut and incomplete', async () => {
    const saved = await withText('a'.repeat(CV_TEXT_MAX_CHARS));

    const preview = await repository.textPreviewOf(saved.id, ANA);

    expect(preview?.chars).toBe(CV_TEXT_PREVIEW_CHARS);
    expect(preview?.complete).toBe(false);
    expect(preview?.status).toBe('extracted');
  });

  it('Justo 2.000 caracteres', async () => {
    const saved = await withText('a'.repeat(CV_TEXT_PREVIEW_CHARS));
    const longer = await withText('b'.repeat(50_000));

    const exact = await repository.textPreviewOf(saved.id, ANA);
    const fifty = await repository.textPreviewOf(longer.id, ANA);

    expect(exact?.chars).toBe(CV_TEXT_PREVIEW_CHARS);
    expect(exact?.complete).toBe(true);
    expect(fifty?.chars).toBe(CV_TEXT_PREVIEW_CHARS);
    expect(fifty?.complete).toBe(false);
  });

  it('Un CV corto se ve entero', async () => {
    const saved = await withText('c'.repeat(900));

    const preview = await repository.textPreviewOf(saved.id, ANA);

    expect(preview).toEqual({
      status: 'extracted',
      text: 'c'.repeat(900),
      chars: 900,
      complete: true,
    });
  });

  it('Todavía no hay texto', async () => {
    const saved = await upload(ANA);

    const preview = await repository.textPreviewOf(saved.id, ANA);

    expect(preview).toEqual({
      status: 'pending',
      text: '',
      chars: 0,
      complete: false,
    });
  });

  it('answers null for the CV of another person or a malformed id', async () => {
    const saved = await withText('lo que sea');

    await expect(repository.textPreviewOf(saved.id, BETO)).resolves.toBeNull();
    await expect(repository.textPreviewOf('nope', ANA)).resolves.toBeNull();
  });

  it('La consulta no se trae el CV entero', () => {
    const projection = JSON.stringify(textPreviewProjection());

    expect(projection).toContain('$substrCP');
    expect(projection).toContain('$strLenCP');
    // El campo entero no se proyecta: lo único que sale de él es el prefijo y su longitud.
    expect(projection).not.toContain('"extractedText":1');
  });
});
