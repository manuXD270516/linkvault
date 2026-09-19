import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type ClientSession, type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { GroupLinkComment } from '../domain/group-link-comment';
import type { LinkCursor } from '../application/ports/link-listing';
import {
  GROUP_LINK_COMMENT_MODEL_NAME,
  GROUP_LINK_COMMENTS_COLLECTION,
} from './group-link-comment.schemas';
import {
  latestPipeline,
  MongoGroupLinkCommentRepository,
} from './mongo-group-link-comment.repository';

// Adaptador Mongo de GROUP_LINK_COMMENT_REPOSITORY (tareas 2.5 y 2.6 de group-comments) contra el MongoMemoryReplSet del
// preset de @linkvault/testing. Las escrituras usan siempre la sesión que reciben: dentro de una transacción abortada no
// dejan nada.

let connection: Connection;
let comments: MongoGroupLinkCommentRepository;

const id = () => new mongoose.Types.ObjectId().toHexString();
const BETO = id();
const BACKEND = id();
const FRONTEND = id();
const LINK = id();
const OTHER_LINK = id();
const at = (second: number) =>
  new Date(Date.UTC(2026, 8, 19, 10, 0, second, 0));

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `comments-${randomUUID()}` })
    .asPromise();
  comments = new MongoGroupLinkCommentRepository(connection);
  await connection.model(GROUP_LINK_COMMENT_MODEL_NAME).init();
});

afterEach(async () => {
  await connection.collection(GROUP_LINK_COMMENTS_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

/** Ejecuta `work` en una transacción que se confirma. */
async function committed<T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
}

/** Ejecuta `work` en una transacción que se aborta al final. */
async function aborted<T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    session.startTransaction();
    const result = await work(session);
    await session.abortTransaction();
    return result;
  } finally {
    await session.endSession();
  }
}

function insert(
  groupId: string,
  linkId: string,
  second: number,
  text = 'Piden inglés C1',
): Promise<GroupLinkComment> {
  return committed((session) =>
    comments.insert(
      { groupId, linkId, authorId: BETO, text, createdAt: at(second) },
      session,
    ),
  );
}

async function stored(): Promise<number> {
  return await connection
    .collection(GROUP_LINK_COMMENTS_COLLECTION)
    .countDocuments();
}

describe('insert and find', () => {
  it('stores the comment with the session it gets and finds it', async () => {
    const comment = await insert(BACKEND, LINK, 1);

    expect(comment).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      groupId: BACKEND,
      linkId: LINK,
      authorId: BETO,
      text: 'Piden inglés C1',
      createdAt: at(1),
    });
    expect(await comments.find(BACKEND, LINK, comment.id)).toEqual(comment);
  });

  it('leaves nothing behind inside an aborted transaction', async () => {
    const comment = await aborted((session) =>
      comments.insert(
        {
          groupId: BACKEND,
          linkId: LINK,
          authorId: BETO,
          text: 'Hola',
          createdAt: at(1),
        },
        session,
      ),
    );

    expect(await comments.find(BACKEND, LINK, comment.id)).toBeNull();
    expect(await stored()).toBe(0);
  });

  it('does not find it through another link, another group or a malformed id', async () => {
    const comment = await insert(BACKEND, LINK, 1);

    expect(await comments.find(BACKEND, OTHER_LINK, comment.id)).toBeNull();
    expect(await comments.find(FRONTEND, LINK, comment.id)).toBeNull();
    expect(await comments.find(BACKEND, LINK, 'no-es-un-id')).toBeNull();
    expect(await comments.find('no-es-un-id', LINK, comment.id)).toBeNull();
  });
});

describe('deletions with the session they get', () => {
  it('deleteOne deletes once, and not inside an aborted transaction', async () => {
    const comment = await insert(BACKEND, LINK, 1);

    expect(
      await aborted((session) =>
        comments.deleteOne(BACKEND, LINK, comment.id, session),
      ),
    ).toBe(true);
    expect(await stored()).toBe(1);
    expect(
      await committed((session) =>
        comments.deleteOne(BACKEND, OTHER_LINK, comment.id, session),
      ),
    ).toBe(false);
    expect(
      await committed((session) =>
        comments.deleteOne(BACKEND, LINK, comment.id, session),
      ),
    ).toBe(true);
    expect(
      await committed((session) =>
        comments.deleteOne(BACKEND, LINK, comment.id, session),
      ),
    ).toBe(false);
  });

  it('deleteByRelation takes only that link in that group', async () => {
    await insert(BACKEND, LINK, 1);
    await insert(BACKEND, LINK, 2);
    await insert(BACKEND, OTHER_LINK, 3);
    await insert(FRONTEND, LINK, 4);

    expect(
      await aborted((session) =>
        comments.deleteByRelation(BACKEND, LINK, session),
      ),
    ).toBe(2);
    expect(await stored()).toBe(4);
    expect(
      await committed((session) =>
        comments.deleteByRelation(BACKEND, LINK, session),
      ),
    ).toBe(2);
    expect(await stored()).toBe(2);
  });

  it('deleteByGroup takes only that group', async () => {
    await insert(BACKEND, LINK, 1);
    await insert(BACKEND, OTHER_LINK, 2);
    await insert(FRONTEND, LINK, 3);

    expect(
      await aborted((session) => comments.deleteByGroup(BACKEND, session)),
    ).toBe(2);
    expect(await stored()).toBe(3);
    expect(
      await committed((session) => comments.deleteByGroup(BACKEND, session)),
    ).toBe(2);
    expect(await comments.page(FRONTEND, LINK, { limit: 20 })).toMatchObject({
      items: [expect.objectContaining({ groupId: FRONTEND })],
    });
  });

  it('answers zero for malformed ids', async () => {
    expect(
      await committed((session) =>
        comments.deleteByRelation('no-es-un-id', LINK, session),
      ),
    ).toBe(0);
    expect(
      await committed((session) =>
        comments.deleteByGroup('no-es-un-id', session),
      ),
    ).toBe(0);
  });
});

describe('page', () => {
  it('walks 45 comments in 20 + 20 + 5, newest first, without gaps or repeats', async () => {
    // 30 en el mismo instante: el `_id` desempata.
    await connection.collection(GROUP_LINK_COMMENTS_COLLECTION).insertMany(
      Array.from({ length: 45 }, (_, index) => ({
        _id: new mongoose.Types.ObjectId(),
        groupId: new mongoose.Types.ObjectId(BACKEND),
        linkId: new mongoose.Types.ObjectId(LINK),
        authorId: new mongoose.Types.ObjectId(BETO),
        text: `c${index}`,
        createdAt: index < 30 ? at(0) : at(index),
      })),
    );
    const sizes: number[] = [];
    const seen: GroupLinkComment[] = [];
    let cursor: LinkCursor | undefined;
    do {
      const page = await comments.page(BACKEND, LINK, {
        limit: 20,
        ...(cursor === undefined ? {} : { cursor }),
      });
      sizes.push(page.items.length);
      seen.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    expect(sizes).toEqual([20, 20, 5]);
    expect(new Set(seen.map((comment) => comment.id)).size).toBe(45);
    const order = seen.map((comment) => [comment.createdAt.getTime(), comment.id]);
    const sorted = [...order].sort((a, b) =>
      a[0] !== b[0] ? Number(b[0]) - Number(a[0]) : a[1] < b[1] ? 1 : -1,
    );
    expect(order).toEqual(sorted);
  });

  it('does not mix threads of other links or groups', async () => {
    await insert(BACKEND, LINK, 1);
    await insert(FRONTEND, LINK, 2);

    const page = await comments.page(FRONTEND, LINK, { limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.groupId).toBe(FRONTEND);
    expect((await comments.page('no-es-un-id', LINK, { limit: 20 })).items).toEqual(
      [],
    );
  });

  it('reads the thread by the index, without scanning the collection', async () => {
    const explained: unknown = await connection
      .collection(GROUP_LINK_COMMENTS_COLLECTION)
      .find({
        groupId: new mongoose.Types.ObjectId(BACKEND),
        linkId: new mongoose.Types.ObjectId(LINK),
      })
      .sort({ createdAt: -1, _id: -1 })
      .explain('queryPlanner');
    const plan = JSON.stringify(explained);

    expect(plan).not.toContain('COLLSCAN');
    expect(plan).toContain('groupId_1_linkId_1_createdAt_-1__id_-1');
  });
});

describe('latestByLinks', () => {
  it('answers the two newest of each link, and leaves out links without comments', async () => {
    await insert(BACKEND, LINK, 1, 'Ana');
    await insert(BACKEND, LINK, 2, 'Beto');
    await insert(BACKEND, LINK, 3, 'Carla');
    await insert(BACKEND, OTHER_LINK, 4, 'Solo');
    await insert(FRONTEND, LINK, 5, 'Otro grupo');
    const empty = id();

    const latest = await comments.latestByLinks(BACKEND, [
      LINK,
      OTHER_LINK,
      empty,
      'no-es-un-id',
    ]);

    expect(latest.get(LINK)?.map((comment) => comment.text)).toEqual([
      'Carla',
      'Beto',
    ]);
    expect(latest.get(OTHER_LINK)?.map((comment) => comment.text)).toEqual([
      'Solo',
    ]);
    expect(latest.has(empty)).toBe(false);
    expect(latest.size).toBe(2);
  });

  it('breaks a tie on the date by id, like the thread', async () => {
    const first = await insert(BACKEND, LINK, 1, 'uno');
    const second = await insert(BACKEND, LINK, 1, 'dos');
    const third = await insert(BACKEND, LINK, 1, 'tres');

    const latest = await comments.latestByLinks(BACKEND, [LINK]);

    const expected = [first, second, third]
      .map((comment) => comment.id)
      .sort()
      .reverse()
      .slice(0, 2);
    expect(latest.get(LINK)?.map((comment) => comment.id)).toEqual(expected);
  });

  it('answers an empty map without asking for malformed ids', async () => {
    expect(await comments.latestByLinks('no-es-un-id', [LINK])).toEqual(
      new Map(),
    );
    expect(await comments.latestByLinks(BACKEND, [])).toEqual(new Map());
  });

  it('matches by the index, without scanning the collection', async () => {
    const explained: unknown = await connection
      .collection(GROUP_LINK_COMMENTS_COLLECTION)
      .aggregate(
        latestPipeline(new mongoose.Types.ObjectId(BACKEND), [
          new mongoose.Types.ObjectId(LINK),
          new mongoose.Types.ObjectId(OTHER_LINK),
        ]),
      )
      .explain('queryPlanner');
    const plan = JSON.stringify(explained);

    expect(plan).not.toContain('COLLSCAN');
    expect(plan).toContain('groupId_1_linkId_1_createdAt_-1__id_-1');
  });
});
