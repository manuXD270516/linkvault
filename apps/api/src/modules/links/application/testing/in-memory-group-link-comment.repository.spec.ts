import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryGroupLinkCommentRepository } from './in-memory-group-link-comment.repository';
import { objectId } from './link-fixtures';
import { IN_MEMORY_SESSION } from './links-test-doubles';

// Doble de comentarios (tarea 2.4 de group-comments): el mismo orden, el mismo cursor y los mismos "no está" que el
// adaptador Mongo, sin tocar contadores.

const BETO = objectId(2);
const BACKEND = objectId(10);
const FRONTEND = objectId(11);
const LINK = objectId(20);
const OTHER_LINK = objectId(21);
const at = (minute: number) =>
  new Date(Date.UTC(2026, 8, 19, 10, minute, 0, 0));

let comments: InMemoryGroupLinkCommentRepository;

beforeEach(() => {
  comments = new InMemoryGroupLinkCommentRepository();
});

function seed(groupId: string, linkId: string, minute: number, text = 'Hola') {
  return comments.seed({
    groupId,
    linkId,
    authorId: BETO,
    text,
    createdAt: at(minute),
  });
}

describe('insert and find', () => {
  it('stores with the session it gets and finds only in the right link and group', async () => {
    const stored = await comments.insert(
      {
        groupId: BACKEND,
        linkId: LINK,
        authorId: BETO,
        text: 'Piden C1',
        createdAt: at(1),
      },
      IN_MEMORY_SESSION,
    );

    expect(comments.lastSession).toBe(IN_MEMORY_SESSION);
    expect(await comments.find(BACKEND, LINK, stored.id)).toEqual(stored);
    expect(await comments.find(BACKEND, OTHER_LINK, stored.id)).toBeNull();
    expect(await comments.find(FRONTEND, LINK, stored.id)).toBeNull();
    expect(await comments.find(BACKEND, LINK, 'no-es-un-id')).toBeNull();
  });
});

describe('deletions', () => {
  it('deletes one comment once', async () => {
    const stored = seed(BACKEND, LINK, 1);

    expect(
      await comments.deleteOne(BACKEND, LINK, stored.id, IN_MEMORY_SESSION),
    ).toBe(true);
    expect(
      await comments.deleteOne(BACKEND, LINK, stored.id, IN_MEMORY_SESSION),
    ).toBe(false);
  });

  it('deletes by relation and by group without touching the others', async () => {
    seed(BACKEND, LINK, 1);
    seed(BACKEND, OTHER_LINK, 2);
    seed(FRONTEND, LINK, 3);

    expect(
      await comments.deleteByRelation(BACKEND, LINK, IN_MEMORY_SESSION),
    ).toBe(1);
    expect(await comments.deleteByGroup(BACKEND, IN_MEMORY_SESSION)).toBe(1);
    expect(comments.of(FRONTEND, LINK)).toHaveLength(1);
    expect(comments.size).toBe(1);
  });
});

describe('page', () => {
  it('walks the thread newest first without gaps or repeats, also at the same instant', async () => {
    for (let index = 0; index < 45; index += 1) {
      seed(BACKEND, LINK, index < 30 ? 0 : index, `c${index}`);
    }
    const seen: string[] = [];
    let cursor = undefined;
    do {
      const page = await comments.page(BACKEND, LINK, {
        limit: 20,
        ...(cursor === undefined ? {} : { cursor }),
      });
      seen.push(...page.items.map((comment) => comment.id));
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    expect(seen).toHaveLength(45);
    expect(new Set(seen).size).toBe(45);
  });
});

describe('latestByLinks', () => {
  it('answers the two newest of each link in one call, and leaves out links without comments', async () => {
    seed(BACKEND, LINK, 1, 'Ana');
    seed(BACKEND, LINK, 2, 'Beto');
    seed(BACKEND, LINK, 3, 'Carla');
    seed(FRONTEND, OTHER_LINK, 4, 'otro grupo');

    const latest = await comments.latestByLinks(BACKEND, [LINK, OTHER_LINK]);

    expect(comments.latestByLinksCalls).toBe(1);
    expect(latest.get(LINK)?.map((comment) => comment.text)).toEqual([
      'Carla',
      'Beto',
    ]);
    expect(latest.has(OTHER_LINK)).toBe(false);
  });
});
