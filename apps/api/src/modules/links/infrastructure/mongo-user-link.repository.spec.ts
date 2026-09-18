import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { jobLinkDraft } from '../application/testing/link-fixtures';
import {
  JOB_LINK_MODEL_NAME,
  JOB_LINKS_COLLECTION,
  USER_LINK_MODEL_NAME,
  USER_LINKS_COLLECTION,
} from './link.schemas';
import { MongoJobLinkRepository } from './mongo-job-link.repository';
import { MongoUserLinkRepository } from './mongo-user-link.repository';

// Adaptador Mongo del puerto USER_LINK_REPOSITORY (tarea 3.5 de job-links): la lista privada, contra el
// MongoMemoryReplSet del preset de @linkvault/testing. Guardar va dentro de la transacción del alta, como en producción.

let connection: Connection;
let links: MongoJobLinkRepository;
let userLinks: MongoUserLinkRepository;

const ANA = new mongoose.Types.ObjectId().toHexString();
const BETO = new mongoose.Types.ObjectId().toHexString();
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const SEARCH_PAGE =
  'https://www.linkedin.com/jobs/search/?currentJobId=3811111111';
const OTHER_JOB = 'https://www.linkedin.com/jobs/view/3822222222/';
const now = new Date('2026-09-17T10:00:00.000Z');
const later = new Date('2026-09-17T11:00:00.000Z');

/** Guarda la URL en la lista privada de alguien, en la misma transacción, como hará `save-link` sin `groupId`. */
function saveForUser(url: string, userId: string, savedAt = now) {
  return links.withResolvedLink(
    jobLinkDraft(url, { createdBy: userId, now: savedAt }),
    async (resolved, session) => {
      const saved = await userLinks.save(
        { userId, linkId: resolved.link.id, savedAt },
        session,
      );
      return { linkId: resolved.link.id, ...saved };
    },
  );
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `links-${randomUUID()}` })
    .asPromise();
  links = new MongoJobLinkRepository(connection);
  userLinks = new MongoUserLinkRepository(connection);
  await connection.model(JOB_LINK_MODEL_NAME).init();
  await connection.model(USER_LINK_MODEL_NAME).init();
});

afterEach(async () => {
  await connection.collection(JOB_LINKS_COLLECTION).deleteMany({});
  await connection.collection(USER_LINKS_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('save', () => {
  it('saves a link in the private list', async () => {
    const saved = await saveForUser(JOB_PAGE, ANA);

    expect(saved.created).toBe(true);
    expect(saved.relation).toEqual({
      userId: ANA,
      linkId: saved.linkId,
      savedAt: now,
    });
  });

  it('is idempotent: saving the same vacancy twice keeps one entry with its first date', async () => {
    const first = await saveForUser(JOB_PAGE, ANA);
    const second = await saveForUser(SEARCH_PAGE, ANA, later);

    expect(second.created).toBe(false);
    expect(second.linkId).toBe(first.linkId);
    expect(second.relation.savedAt).toEqual(now);
    expect(await userLinks.countByUser(ANA)).toBe(1);
  });

  it('lets two people keep the same vacancy in their own lists', async () => {
    const first = await saveForUser(JOB_PAGE, ANA);
    const second = await saveForUser(JOB_PAGE, BETO, later);

    expect(second.linkId).toBe(first.linkId);
    expect(await userLinks.countByUser(ANA)).toBe(1);
    expect(await userLinks.countByUser(BETO)).toBe(1);
    expect(
      await connection.collection(JOB_LINKS_COLLECTION).countDocuments(),
    ).toBe(1);
  });

  it('refuses malformed ids instead of writing something unreachable', async () => {
    await expect(saveForUser(JOB_PAGE, 'no-es-un-id')).rejects.toThrow(
      'well formed creator id',
    );
  });
});

describe('find, listByUser and countByUser', () => {
  it('lists only the links of that person, the most recent first and with no sharer', async () => {
    const first = await saveForUser(JOB_PAGE, ANA);
    const second = await saveForUser(OTHER_JOB, ANA, later);
    await saveForUser(OTHER_JOB, BETO);

    const page = await userLinks.listByUser(ANA, { limit: 20 });

    expect(page.items.map((item) => item.link.id)).toEqual([
      second.linkId,
      first.linkId,
    ]);
    expect(page.items.map((item) => item.sharedBy)).toEqual([
      undefined,
      undefined,
    ]);
    expect(page.items[0]?.sharedAt).toEqual(later);
    expect(page.items[0]?.link.displayUrl).toBe(OTHER_JOB);
    expect(await userLinks.countByUser(ANA)).toBe(2);
  });

  it('answers an empty list for someone with nothing saved or a malformed id', async () => {
    expect((await userLinks.listByUser(BETO, { limit: 20 })).items).toEqual([]);
    expect((await userLinks.listByUser('no-es-un-id', { limit: 20 })).items).toEqual(
      [],
    );
    expect(await userLinks.countByUser('no-es-un-id')).toBe(0);
  });

  it('finds an entry and answers null for one that is not there', async () => {
    const { linkId } = await saveForUser(JOB_PAGE, ANA);

    expect(await userLinks.find(ANA, linkId)).toEqual({
      userId: ANA,
      linkId,
      savedAt: now,
    });
    expect(await userLinks.find(BETO, linkId)).toBeNull();
    expect(await userLinks.find(ANA, 'no-es-un-id')).toBeNull();
  });
});

describe('remove and deleteByLink', () => {
  it('removes the entry and never the vacancy', async () => {
    const { linkId } = await saveForUser(JOB_PAGE, ANA);

    expect(await userLinks.remove(ANA, linkId)).toBe(true);
    expect(await userLinks.find(ANA, linkId)).toBeNull();
    expect(await links.findById(linkId)).not.toBeNull();
  });

  it('answers false when the link was not in that list', async () => {
    const { linkId } = await saveForUser(JOB_PAGE, ANA);

    expect(await userLinks.remove(BETO, linkId)).toBe(false);
    expect(await userLinks.remove('no-es-un-id', linkId)).toBe(false);
  });

  it('deletes the private entries of a link, of everybody', async () => {
    const { linkId } = await saveForUser(JOB_PAGE, ANA);
    await saveForUser(JOB_PAGE, BETO, later);

    expect(await userLinks.deleteByLink(linkId)).toBe(2);
    expect(
      await connection.collection(USER_LINKS_COLLECTION).countDocuments(),
    ).toBe(0);
    expect(await userLinks.deleteByLink('no-es-un-id')).toBe(0);
  });
});
