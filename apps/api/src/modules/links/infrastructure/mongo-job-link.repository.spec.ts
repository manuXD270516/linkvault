import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { jobLinkDraft, objectId } from '../application/testing/link-fixtures';
import { MAX_ORIGINAL_URLS, type NewJobLink } from '../domain/job-link';
import { JOB_LINK_MODEL_NAME, JOB_LINKS_COLLECTION } from './link.schemas';
import { MongoJobLinkRepository } from './mongo-job-link.repository';

// Adaptador Mongo del puerto JOB_LINK_REPOSITORY (tarea 3.3 de job-links) contra el MongoMemoryReplSet del preset de
// @linkvault/testing: el upsert y el trabajo del caso de uso van en una transacción, que necesita el replica set.

let connection: Connection;
let repository: MongoJobLinkRepository;

const ANA = new mongoose.Types.ObjectId().toHexString();
const BETO = new mongoose.Types.ObjectId().toHexString();
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const SEARCH_PAGE =
  'https://www.linkedin.com/jobs/search/?currentJobId=3811111111';
const now = new Date('2026-09-17T10:00:00.000Z');
const later = new Date('2026-09-17T11:00:00.000Z');

/** Guarda una URL como haría el caso de uso y devuelve la vacante resuelta. */
function save(url: string, createdBy = ANA, at = now) {
  return repository.withResolvedLink(
    jobLinkDraft(url, { createdBy, now: at }),
    (resolved) => Promise.resolve(resolved),
  );
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `links-${randomUUID()}` })
    .asPromise();
  repository = new MongoJobLinkRepository(connection);
  await connection.model(JOB_LINK_MODEL_NAME).init();
});

afterEach(async () => {
  await connection.collection(JOB_LINKS_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('withResolvedLink', () => {
  it('stores a new vacancy as pending, with its dedupe key and its displayUrl', async () => {
    const { link, created } = await save(
      'HTTP://WWW.linkedin.com/jobs/view/3811111111/?utm_source=wa',
    );

    expect(created).toBe(true);
    expect(link.previewStatus).toBe('pending');
    expect(link.previewVersion).toBe(1);
    expect(link.dedupeKey).toBe('linkedin:3811111111');
    expect(link.normalizedUrl).toBe('https://linkedin.com/jobs/view/3811111111');
    expect(link.displayUrl).toBe(
      'HTTP://WWW.linkedin.com/jobs/view/3811111111/?utm_source=wa',
    );
    expect(link.createdBy).toBe(ANA);
  });

  it('Misma vacante con dos URLs', async () => {
    const first = await save(JOB_PAGE, ANA);
    const second = await save(SEARCH_PAGE, BETO, later);

    expect(second.created).toBe(false);
    expect(second.link.id).toBe(first.link.id);
    expect(second.link.originalUrls).toEqual([JOB_PAGE, SEARCH_PAGE]);
    expect(second.link.displayUrl).toBe(JOB_PAGE);
    expect(
      await connection.collection(JOB_LINKS_COLLECTION).countDocuments(),
    ).toBe(1);
  });

  it('Vacantes distintas de la misma plataforma', async () => {
    const one = await save(JOB_PAGE);
    const other = await save('https://www.linkedin.com/jobs/view/3822222222/');

    expect(other.link.id).not.toBe(one.link.id);
    expect(
      await connection.collection(JOB_LINKS_COLLECTION).countDocuments(),
    ).toBe(2);
  });

  it('dedupes an unrecognized url by the hash of its normalized url', async () => {
    const first = await save('https://empresa.example/careers/backend');
    const same = await save(
      'HTTP://WWW.Empresa.example/careers/backend/?utm_source=wa&gclid=1',
    );

    expect(same.link.id).toBe(first.link.id);
    expect(same.link.dedupeKey).toBe(`url:${first.link.urlHash}`);
    expect(same.link.externalJobId).toBeUndefined();
  });

  it('does not repeat a url that was already in the history', async () => {
    await save(JOB_PAGE);
    const again = await save(JOB_PAGE, BETO);

    expect(again.link.originalUrls).toEqual([JOB_PAGE]);
  });

  it('Historial acotado', async () => {
    const first = await save(JOB_PAGE);
    for (let index = 0; index < 24; index += 1) {
      const saved = await save(`${SEARCH_PAGE}&ts=${index}`, BETO, later);
      expect(saved.created).toBe(false);
    }
    const link = await repository.findById(first.link.id);

    expect(link?.originalUrls).toHaveLength(MAX_ORIGINAL_URLS);
    // El recorte se lleva las primeras del historial y aun así `displayUrl` sigue siendo la del alta.
    expect(link?.originalUrls).not.toContain(JOB_PAGE);
    expect(link?.displayUrl).toBe(JOB_PAGE);
    expect(
      await connection.collection(JOB_LINKS_COLLECTION).countDocuments(),
    ).toBe(1);
  });

  it('Altas simultáneas de la misma URL', async () => {
    const [one, other] = await Promise.all([
      save(JOB_PAGE, ANA),
      save(SEARCH_PAGE, BETO),
    ]);

    expect(
      await connection
        .collection(JOB_LINKS_COLLECTION)
        .countDocuments({ dedupeKey: 'linkedin:3811111111' }),
    ).toBe(1);
    expect(one.link.id).toBe(other.link.id);
    // Una de las dos creó la vacante y la otra la reutilizó, pero ninguna falló.
    expect([one.created, other.created].filter(Boolean)).toHaveLength(1);
    const link = await repository.findById(one.link.id);
    expect(link?.originalUrls).toHaveLength(2);
  });

  it('runs the work of the use case inside the same transaction', async () => {
    const written: string[] = [];
    await repository.withResolvedLink(
      jobLinkDraft(JOB_PAGE, { createdBy: ANA }),
      async (resolved, session) => {
        // Lo que el caso de uso escribiría con la sesión: aquí basta con leer dentro de ella.
        const seen = await connection
          .collection(JOB_LINKS_COLLECTION)
          .findOne(
            { _id: new mongoose.Types.ObjectId(resolved.link.id) },
            { session: session as never },
          );
        written.push(String(seen?.['dedupeKey']));
      },
    );

    expect(written).toEqual(['linkedin:3811111111']);
  });

  it('leaves nothing behind when the work of the use case fails', async () => {
    await expect(
      repository.withResolvedLink(
        jobLinkDraft(JOB_PAGE, { createdBy: ANA }),
        () => Promise.reject(new Error('the outbox write failed')),
      ),
    ).rejects.toThrow('the outbox write failed');

    expect(
      await connection.collection(JOB_LINKS_COLLECTION).countDocuments(),
    ).toBe(0);
  });

  it('refuses a draft with a malformed creator id', async () => {
    const draft: NewJobLink = {
      ...jobLinkDraft(JOB_PAGE),
      createdBy: 'no-es-un-id',
    };

    await expect(
      repository.withResolvedLink(draft, (resolved) => Promise.resolve(resolved)),
    ).rejects.toThrow('well formed creator id');
  });
});

describe('findById', () => {
  it('finds a link that exists', async () => {
    const { link } = await save(JOB_PAGE);

    expect((await repository.findById(link.id))?.id).toBe(link.id);
  });

  it('answers null for an unknown or malformed id', async () => {
    expect(await repository.findById(objectId(99))).toBeNull();
    expect(await repository.findById('no-es-un-id')).toBeNull();
  });
});
