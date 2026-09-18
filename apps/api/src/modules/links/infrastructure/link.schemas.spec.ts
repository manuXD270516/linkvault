import { randomUUID } from 'node:crypto';
import { platformSchema, previewStatusSchema } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { mongo, type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GROUP_LINK_MODEL_NAME,
  GROUP_LINKS_COLLECTION,
  JOB_LINK_MODEL_NAME,
  JOB_LINKS_COLLECTION,
  USER_LINK_MODEL_NAME,
  USER_LINKS_COLLECTION,
  groupLinkSchema,
  jobLinkSchema,
  toGroupObjectId,
  toLinkObjectId,
  toUserObjectId,
  userLinkSchema,
  type GroupLinkDocument,
  type JobLinkDocument,
  type UserLinkDocument,
} from './link.schemas';

// Schemas de `job_links`, `group_links` y `user_links` (tarea 3.2 de job-links) contra el MongoMemoryReplSet del preset
// de @linkvault/testing. Se espera `Model.init()` antes de probar los índices.

let connection: Connection;

const now = new Date('2026-09-17T10:00:00.000Z');
const GROUP_ID = new mongoose.Types.ObjectId();
const USER_ID = new mongoose.Types.ObjectId();
const LINK_ID = new mongoose.Types.ObjectId();

/** Código del error del driver, o `undefined` si la escritura no falló. `11000` es la clave duplicada. */
async function writeErrorCode(
  write: Promise<unknown>,
): Promise<number | string | undefined> {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error instanceof mongo.MongoServerError ? error.code : undefined;
  }
}

/** `true` si el plan elegido recorre la colección entera en algún punto. */
async function scansTheWholeCollection(
  collection: string,
  filter: Record<string, unknown>,
  sort: Record<string, 1 | -1>,
): Promise<boolean> {
  const explained: unknown = await connection
    .collection(collection)
    .find(filter)
    .sort(sort)
    .explain('queryPlanner');
  return JSON.stringify(explained).includes('COLLSCAN');
}

function jobLinkDocument(dedupeKey: string): Omit<JobLinkDocument, '_id'> {
  return {
    normalizedUrl: 'https://linkedin.com/jobs/view/3811111111',
    urlHash: 'a'.repeat(64),
    dedupeKey,
    platform: 'linkedin',
    externalJobId: '3811111111',
    displayUrl: 'https://www.linkedin.com/jobs/view/3811111111/?utm_source=wa',
    originalUrls: [
      'https://www.linkedin.com/jobs/view/3811111111/?utm_source=wa',
    ],
    previewStatus: 'pending',
    previewVersion: 1,
    createdBy: USER_ID,
    createdAt: now,
    updatedAt: now,
  };
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `links-${randomUUID()}` })
    .asPromise();
  connection.model<JobLinkDocument>(JOB_LINK_MODEL_NAME, jobLinkSchema);
  connection.model<GroupLinkDocument>(GROUP_LINK_MODEL_NAME, groupLinkSchema);
  connection.model<UserLinkDocument>(USER_LINK_MODEL_NAME, userLinkSchema);
  await connection.model(JOB_LINK_MODEL_NAME).init();
  await connection.model(GROUP_LINK_MODEL_NAME).init();
  await connection.model(USER_LINK_MODEL_NAME).init();
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('job_links collection', () => {
  it('declares bufferCommands false and a unique index on the dedupe key', async () => {
    expect(jobLinkSchema.get('bufferCommands')).toBe(false);
    const indexes = await connection.collection(JOB_LINKS_COLLECTION).indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { dedupeKey: 1 }, unique: true }),
    );
  });

  it('declares the index the backfill walks by preview status', async () => {
    const indexes = await connection.collection(JOB_LINKS_COLLECTION).indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { previewStatus: 1, _id: 1 } }),
    );
  });

  it('answers the backfill query without scanning the whole collection', async () => {
    await expect(
      scansTheWholeCollection(
        JOB_LINKS_COLLECTION,
        { previewStatus: 'pending' },
        { _id: 1 },
      ),
    ).resolves.toBe(false);
  });

  it('rejects a second vacancy with the same dedupe key', async () => {
    const model = connection.model<JobLinkDocument>(JOB_LINK_MODEL_NAME);
    await model.create(jobLinkDocument('linkedin:3811111111'));

    await expect(
      writeErrorCode(model.create(jobLinkDocument('linkedin:3811111111'))),
    ).resolves.toBe(11_000);
    expect(
      await connection
        .collection(JOB_LINKS_COLLECTION)
        .countDocuments({ dedupeKey: 'linkedin:3811111111' }),
    ).toBe(1);
  });

  it('accepts the two shapes of the dedupe key', async () => {
    const model = connection.model<JobLinkDocument>(JOB_LINK_MODEL_NAME);

    await expect(
      writeErrorCode(model.create(jobLinkDocument(`url:${'b'.repeat(64)}`))),
    ).resolves.toBeUndefined();
  });

  it('stores displayUrl as its own field, next to the history', async () => {
    const model = connection.model<JobLinkDocument>(JOB_LINK_MODEL_NAME);
    const created = await model.create(jobLinkDocument('linkedin:3899999999'));
    const raw = await connection
      .collection(JOB_LINKS_COLLECTION)
      .findOne({ _id: created._id });

    expect(raw?.['displayUrl']).toBe(
      'https://www.linkedin.com/jobs/view/3811111111/?utm_source=wa',
    );
    expect(raw?.['originalUrls']).toEqual([
      'https://www.linkedin.com/jobs/view/3811111111/?utm_source=wa',
    ]);
  });

  it('accepts only the platforms and the preview states of the contract', () => {
    expect(jobLinkSchema.path('platform').options['enum']).toEqual([
      ...platformSchema.options,
    ]);
    expect(jobLinkSchema.path('previewStatus').options['enum']).toEqual([
      ...previewStatusSchema.options,
    ]);
  });

  it('stores no preview data yet: a new link only knows its url and platform', async () => {
    const model = connection.model<JobLinkDocument>(JOB_LINK_MODEL_NAME);
    const created = await model.create({
      ...jobLinkDocument('linkedin:3877777777'),
      // `strict: true`: un campo que no está en el schema no se guarda.
      title: 'Backend Developer',
    } as never);
    const raw = await connection
      .collection(JOB_LINKS_COLLECTION)
      .findOne({ _id: created._id });

    expect(raw?.['title']).toBeUndefined();
  });
});

describe('group_links collection', () => {
  it('declares the unique relation and the paginated listing index', async () => {
    expect(groupLinkSchema.get('bufferCommands')).toBe(false);
    const indexes = await connection
      .collection(GROUP_LINKS_COLLECTION)
      .indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { groupId: 1, linkId: 1 }, unique: true }),
    );
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { groupId: 1, sharedAt: -1, _id: -1 } }),
    );
  });

  it('declares the index that finds who can see a link', async () => {
    const indexes = await connection
      .collection(GROUP_LINKS_COLLECTION)
      .indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { linkId: 1 } }),
    );
  });

  it('answers the fan out query without scanning the whole collection', async () => {
    await expect(
      scansTheWholeCollection(
        GROUP_LINKS_COLLECTION,
        { linkId: LINK_ID },
        { _id: 1 },
      ),
    ).resolves.toBe(false);
  });

  it('rejects the same link twice in the same group', async () => {
    const model = connection.model<GroupLinkDocument>(GROUP_LINK_MODEL_NAME);
    await model.create({
      groupId: GROUP_ID,
      linkId: LINK_ID,
      sharedBy: USER_ID,
      sharedAt: now,
    });

    await expect(
      writeErrorCode(
        model.create({
          groupId: GROUP_ID,
          linkId: LINK_ID,
          sharedBy: new mongoose.Types.ObjectId(),
          sharedAt: now,
        }),
      ),
    ).resolves.toBe(11_000);
    expect(
      await connection
        .collection(GROUP_LINKS_COLLECTION)
        .countDocuments({ groupId: GROUP_ID, linkId: LINK_ID }),
    ).toBe(1);
  });

  it('accepts the same link in another group', async () => {
    const model = connection.model<GroupLinkDocument>(GROUP_LINK_MODEL_NAME);

    await expect(
      writeErrorCode(
        model.create({
          groupId: new mongoose.Types.ObjectId(),
          linkId: LINK_ID,
          sharedBy: USER_ID,
          sharedAt: now,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('user_links collection', () => {
  it('declares the unique entry and the paginated listing index', async () => {
    expect(userLinkSchema.get('bufferCommands')).toBe(false);
    const indexes = await connection.collection(USER_LINKS_COLLECTION).indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { userId: 1, linkId: 1 }, unique: true }),
    );
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { userId: 1, savedAt: -1, _id: -1 } }),
    );
  });

  it('declares the index that finds who has a link in their private list', async () => {
    const indexes = await connection.collection(USER_LINKS_COLLECTION).indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { linkId: 1 } }),
    );
  });

  it('answers the fan out query without scanning the whole collection', async () => {
    await expect(
      scansTheWholeCollection(
        USER_LINKS_COLLECTION,
        { linkId: LINK_ID },
        { _id: 1 },
      ),
    ).resolves.toBe(false);
  });

  it('rejects the same link twice in the same private list', async () => {
    const model = connection.model<UserLinkDocument>(USER_LINK_MODEL_NAME);
    await model.create({ userId: USER_ID, linkId: LINK_ID, savedAt: now });

    await expect(
      writeErrorCode(
        model.create({ userId: USER_ID, linkId: LINK_ID, savedAt: now }),
      ),
    ).resolves.toBe(11_000);
  });

  it('accepts the same link in the list of another person', async () => {
    const model = connection.model<UserLinkDocument>(USER_LINK_MODEL_NAME);

    await expect(
      writeErrorCode(
        model.create({
          userId: new mongoose.Types.ObjectId(),
          linkId: LINK_ID,
          savedAt: now,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

describe('format guards', () => {
  it('turns a well formed id into an ObjectId', () => {
    const id = LINK_ID.toHexString();

    expect(toLinkObjectId(id)?.toHexString()).toBe(id);
    expect(toGroupObjectId(id)?.toHexString()).toBe(id);
    expect(toUserObjectId(id)?.toHexString()).toBe(id);
  });

  it.each(['no-es-un-id', '', 'twelve-bytes', `${LINK_ID.toHexString()} `])(
    'returns null for %j without throwing',
    (id) => {
      expect(toLinkObjectId(id)).toBeNull();
      expect(toGroupObjectId(id)).toBeNull();
      expect(toUserObjectId(id)).toBeNull();
    },
  );
});
