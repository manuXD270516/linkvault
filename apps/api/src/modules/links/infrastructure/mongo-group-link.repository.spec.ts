import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { jobLinkDraft } from '../application/testing/link-fixtures';
import {
  GROUP_LINK_MODEL_NAME,
  GROUP_LINKS_COLLECTION,
  JOB_LINK_MODEL_NAME,
  JOB_LINKS_COLLECTION,
} from './link.schemas';
import { MongoGroupLinkRepository } from './mongo-group-link.repository';
import { MongoJobLinkRepository } from './mongo-job-link.repository';

// Adaptador Mongo del puerto GROUP_LINK_REPOSITORY (tarea 3.4 de job-links) contra el MongoMemoryReplSet del preset de
// @linkvault/testing. Compartir va dentro de la transacción del alta, como en producción.

let connection: Connection;
let links: MongoJobLinkRepository;
let groupLinks: MongoGroupLinkRepository;

const ANA = new mongoose.Types.ObjectId().toHexString();
const BETO = new mongoose.Types.ObjectId().toHexString();
const BACKEND = new mongoose.Types.ObjectId().toHexString();
const FRONTEND = new mongoose.Types.ObjectId().toHexString();
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const SEARCH_PAGE =
  'https://www.linkedin.com/jobs/search/?currentJobId=3811111111';
const OTHER_JOB = 'https://www.linkedin.com/jobs/view/3822222222/';
const now = new Date('2026-09-17T10:00:00.000Z');
const later = new Date('2026-09-17T11:00:00.000Z');

/** Guarda la URL y la comparte en el grupo, todo en la misma transacción, como hará `save-link`. */
function shareLink(
  url: string,
  groupId: string,
  sharedBy: string,
  sharedAt = now,
) {
  return links.withResolvedLink(
    jobLinkDraft(url, { createdBy: sharedBy, now: sharedAt }),
    async (resolved, session) => {
      const shared = await groupLinks.share(
        { groupId, linkId: resolved.link.id, sharedBy, sharedAt },
        session,
      );
      return { linkId: resolved.link.id, ...shared };
    },
  );
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `links-${randomUUID()}` })
    .asPromise();
  links = new MongoJobLinkRepository(connection);
  groupLinks = new MongoGroupLinkRepository(connection);
  await connection.model(JOB_LINK_MODEL_NAME).init();
  await connection.model(GROUP_LINK_MODEL_NAME).init();
});

afterEach(async () => {
  await connection.collection(JOB_LINKS_COLLECTION).deleteMany({});
  await connection.collection(GROUP_LINKS_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('share', () => {
  it('Dos miembros comparten la misma vacante', async () => {
    const first = await shareLink(JOB_PAGE, BACKEND, ANA);
    const second = await shareLink(SEARCH_PAGE, BACKEND, BETO, later);

    expect(second.created).toBe(false);
    expect(second.relation.sharedBy).toBe(ANA);
    expect(second.relation.sharedAt).toEqual(now);
    expect(second.linkId).toBe(first.linkId);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(1);

    const page = await groupLinks.listByGroup(BACKEND, { limit: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.sharedBy).toBe(ANA);
  });

  it('El mismo link en dos grupos', async () => {
    const first = await shareLink(JOB_PAGE, BACKEND, ANA);
    const second = await shareLink(SEARCH_PAGE, FRONTEND, ANA, later);

    expect(second.created).toBe(true);
    expect(second.linkId).toBe(first.linkId);
    expect(
      await connection.collection(JOB_LINKS_COLLECTION).countDocuments(),
    ).toBe(1);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(1);
    expect(await groupLinks.countByGroup(FRONTEND)).toBe(1);
  });

  it('refuses malformed ids instead of writing something unreachable', async () => {
    await expect(
      shareLink(JOB_PAGE, 'no-es-un-id', ANA),
    ).rejects.toThrow('well formed group, link and user ids');
  });
});

describe('find, listByGroup and countByGroup', () => {
  it('finds the relation of a link that is in the group', async () => {
    const { linkId } = await shareLink(JOB_PAGE, BACKEND, ANA);

    expect(await groupLinks.find(BACKEND, linkId)).toEqual({
      groupId: BACKEND,
      linkId,
      sharedBy: ANA,
      sharedAt: now,
    });
  });

  it('answers null for another group, an unknown link or a malformed id', async () => {
    const { linkId } = await shareLink(JOB_PAGE, BACKEND, ANA);

    expect(await groupLinks.find(FRONTEND, linkId)).toBeNull();
    expect(
      await groupLinks.find(BACKEND, new mongoose.Types.ObjectId().toHexString()),
    ).toBeNull();
    expect(await groupLinks.find('no-es-un-id', linkId)).toBeNull();
  });

  it('lists the links of the group with their vacancy and sharer, the most recent first', async () => {
    const first = await shareLink(JOB_PAGE, BACKEND, ANA);
    const second = await shareLink(OTHER_JOB, BACKEND, BETO, later);

    const page = await groupLinks.listByGroup(BACKEND, { limit: 20 });

    expect(page.items.map((item) => item.link.id)).toEqual([
      second.linkId,
      first.linkId,
    ]);
    expect(page.items.map((item) => item.sharedBy)).toEqual([BETO, ANA]);
    expect(page.items[0]?.link.previewStatus).toBe('pending');
    expect(page.items[0]?.link.displayUrl).toBe(OTHER_JOB);
    expect(page.items[0]?.sharedAt).toEqual(later);
    expect(page.nextCursor).toBeUndefined();
  });

  it('does not list the links of another group, and counts zero for a malformed id', async () => {
    await shareLink(JOB_PAGE, BACKEND, ANA);

    expect((await groupLinks.listByGroup(FRONTEND, { limit: 20 })).items).toEqual(
      [],
    );
    expect((await groupLinks.listByGroup('no-es-un-id', { limit: 20 })).items).toEqual(
      [],
    );
    expect(await groupLinks.countByGroup('no-es-un-id')).toBe(0);
  });
});

describe('groupsWithLink', () => {
  it('answers only the groups that were asked for and already have the link', async () => {
    const { linkId } = await shareLink(JOB_PAGE, BACKEND, ANA);
    const strangers = new mongoose.Types.ObjectId().toHexString();
    await shareLink(JOB_PAGE, strangers, BETO);

    expect(
      await groupLinks.groupsWithLink([BACKEND, FRONTEND], linkId),
    ).toEqual(new Set([BACKEND]));
  });

  it('answers an empty set without asking Mongo for nothing', async () => {
    const { linkId } = await shareLink(JOB_PAGE, BACKEND, ANA);

    expect(await groupLinks.groupsWithLink([], linkId)).toEqual(new Set());
    expect(await groupLinks.groupsWithLink([BACKEND], 'no-es-un-id')).toEqual(
      new Set(),
    );
  });
});

describe('remove, deleteByGroup and deleteByLink', () => {
  it('Quitar no destruye la vacante', async () => {
    const { linkId } = await shareLink(JOB_PAGE, BACKEND, ANA);
    await shareLink(SEARCH_PAGE, FRONTEND, ANA, later);

    expect(await groupLinks.remove(BACKEND, linkId)).toBe(true);
    expect(await groupLinks.find(BACKEND, linkId)).toBeNull();
    expect((await groupLinks.listByGroup(FRONTEND, { limit: 20 })).items).toHaveLength(
      1,
    );
    expect(await links.findById(linkId)).not.toBeNull();
  });

  it('answers false when the link was not in that group', async () => {
    const { linkId } = await shareLink(JOB_PAGE, BACKEND, ANA);

    expect(await groupLinks.remove(FRONTEND, linkId)).toBe(false);
    expect(await groupLinks.remove('no-es-un-id', linkId)).toBe(false);
  });

  it('deletes every relation of a group, and only of that group', async () => {
    const session = await connection.startSession();
    await shareLink(JOB_PAGE, BACKEND, ANA);
    await shareLink(OTHER_JOB, BACKEND, BETO);
    await shareLink(JOB_PAGE, FRONTEND, ANA);

    try {
      const deleted = await session.withTransaction(() =>
        groupLinks.deleteByGroup(BACKEND, session),
      );

      expect(deleted).toBe(2);
    } finally {
      await session.endSession();
    }
    expect(await groupLinks.countByGroup(BACKEND)).toBe(0);
    expect(await groupLinks.countByGroup(FRONTEND)).toBe(1);
    // El borrado del grupo se lleva sus relaciones y ninguna vacante.
    expect(
      await connection.collection(JOB_LINKS_COLLECTION).countDocuments(),
    ).toBe(2);
  });

  it('deletes every relation of a link', async () => {
    const { linkId } = await shareLink(JOB_PAGE, BACKEND, ANA);
    await shareLink(SEARCH_PAGE, FRONTEND, ANA, later);

    expect(await groupLinks.deleteByLink(linkId)).toBe(2);
    expect(
      await connection.collection(GROUP_LINKS_COLLECTION).countDocuments(),
    ).toBe(0);
    expect(await groupLinks.deleteByLink('no-es-un-id')).toBe(0);
  });
});

describe('linkIdsIn', () => {
  it('answers which of the links are shared in the group, in one query', async () => {
    const first = await shareLink(JOB_PAGE, BACKEND, ANA);
    const second = await shareLink(OTHER_JOB, FRONTEND, BETO);

    expect(
      await groupLinks.linkIdsIn(BACKEND, [
        first.linkId,
        second.linkId,
        new mongoose.Types.ObjectId().toHexString(),
        'no-es-un-id',
      ]),
    ).toEqual(new Set([first.linkId]));
  });

  it('answers nothing for a malformed group or no well formed link', async () => {
    const first = await shareLink(JOB_PAGE, BACKEND, ANA);

    expect(await groupLinks.linkIdsIn('no-es-un-id', [first.linkId])).toEqual(
      new Set(),
    );
    expect(await groupLinks.linkIdsIn(BACKEND, ['no-es-un-id'])).toEqual(
      new Set(),
    );
  });

  it('uses the unique (groupId, linkId) index', async () => {
    const first = await shareLink(JOB_PAGE, BACKEND, ANA);
    const plan: unknown = await connection
      .collection(GROUP_LINKS_COLLECTION)
      .find({
        groupId: new mongoose.Types.ObjectId(BACKEND),
        linkId: { $in: [new mongoose.Types.ObjectId(first.linkId)] },
      })
      .explain('queryPlanner');

    expect(JSON.stringify(plan)).toContain('"groupId":1,"linkId":1');
  });
});
