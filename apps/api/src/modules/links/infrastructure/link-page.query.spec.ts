import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { encodeCursor, toLinkListQuery } from '../application/link-cursor';
import type { LinkListPage } from '../application/ports/link-listing';
import { jobLinkDraft } from '../application/testing/link-fixtures';
import {
  GROUP_LINK_MODEL_NAME,
  GROUP_LINKS_COLLECTION,
  JOB_LINK_MODEL_NAME,
  JOB_LINKS_COLLECTION,
  USER_LINK_MODEL_NAME,
  USER_LINKS_COLLECTION,
} from './link.schemas';
import { MongoGroupLinkRepository } from './mongo-group-link.repository';
import { MongoJobLinkRepository } from './mongo-job-link.repository';
import { MongoUserLinkRepository } from './mongo-user-link.repository';

// Paginación por cursor opaco `(fecha, _id)` y `total` por conteo (tarea 3.6 de job-links), compartidos por el listado
// de un grupo y por la lista privada, contra el MongoMemoryReplSet del preset de @linkvault/testing.

let connection: Connection;
let links: MongoJobLinkRepository;
let groupLinks: MongoGroupLinkRepository;
let userLinks: MongoUserLinkRepository;

const ANA = new mongoose.Types.ObjectId().toHexString();
const BACKEND = new mongoose.Types.ObjectId().toHexString();
/** Todos en el mismo instante: es el caso de una importación de 50 links, donde solo desempata el `_id`. */
const AT_ONCE = new Date('2026-09-17T10:00:00.000Z');

/** Guarda 50 vacantes distintas en el grupo y en la lista privada, todas con la misma fecha. */
async function saveFifty(): Promise<string[]> {
  const saved: string[] = [];
  for (let index = 0; index < 50; index += 1) {
    const linkId = await links.withResolvedLink(
      jobLinkDraft(`https://empresa.example/careers/${index}`, {
        createdBy: ANA,
        now: AT_ONCE,
      }),
      async (resolved, session) => {
        await groupLinks.share(
          {
            groupId: BACKEND,
            linkId: resolved.link.id,
            sharedBy: ANA,
            sharedAt: AT_ONCE,
          },
          session,
        );
        await userLinks.save(
          { userId: ANA, linkId: resolved.link.id, savedAt: AT_ONCE },
          session,
        );
        return resolved.link.id;
      },
    );
    saved.push(linkId);
  }
  return saved;
}

/** Recorre todas las páginas de un listado y devuelve los ids vistos, en orden. */
async function walk(
  list: (query: { limit: number; cursor?: string }) => Promise<LinkListPage>,
  limit: number,
): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const current: LinkListPage = await list({
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
    seen.push(...current.items.map((item) => item.link.id));
    if (current.nextCursor === undefined) {
      return seen;
    }
    cursor = encodeCursor(current.nextCursor);
  }
  throw new Error('The listing never reached its last page');
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `links-${randomUUID()}` })
    .asPromise();
  links = new MongoJobLinkRepository(connection);
  groupLinks = new MongoGroupLinkRepository(connection);
  userLinks = new MongoUserLinkRepository(connection);
  await connection.model(JOB_LINK_MODEL_NAME).init();
  await connection.model(GROUP_LINK_MODEL_NAME).init();
  await connection.model(USER_LINK_MODEL_NAME).init();
});

afterEach(async () => {
  await connection.collection(JOB_LINKS_COLLECTION).deleteMany({});
  await connection.collection(GROUP_LINKS_COLLECTION).deleteMany({});
  await connection.collection(USER_LINKS_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('Paginación sin saltos ni repetidos', () => {
  it('walks 50 links of a group in pages of 20, seeing each one exactly once', async () => {
    const saved = await saveFifty();

    const seen = await walk(
      (query) => groupLinks.listByGroup(BACKEND, toLinkListQuery(query)),
      20,
    );

    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
    expect(new Set(seen)).toEqual(new Set(saved));
  });

  it('walks the private list the same way', async () => {
    const saved = await saveFifty();

    const seen = await walk(
      (query) => userLinks.listByUser(ANA, toLinkListQuery(query)),
      20,
    );

    expect(seen).toHaveLength(50);
    expect(new Set(seen)).toEqual(new Set(saved));
  });

  it('gives the same order no matter the page size', async () => {
    await saveFifty();

    const byTwenty = await walk(
      (query) => groupLinks.listByGroup(BACKEND, toLinkListQuery(query)),
      20,
    );
    const bySeven = await walk(
      (query) => groupLinks.listByGroup(BACKEND, toLinkListQuery(query)),
      7,
    );

    expect(bySeven).toEqual(byTwenty);
  });

  it('has no next cursor on the last page', async () => {
    await saveFifty();

    const page = await groupLinks.listByGroup(BACKEND, { limit: 50 });

    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toBeUndefined();
  });
});

describe('total', () => {
  it('does not depend on the page size', async () => {
    await saveFifty();

    const total = await groupLinks.countByGroup(BACKEND);
    const firstOfTwenty = await groupLinks.listByGroup(BACKEND, { limit: 20 });
    const firstOfFive = await groupLinks.listByGroup(BACKEND, { limit: 5 });

    expect(total).toBe(50);
    expect(firstOfTwenty.items).toHaveLength(20);
    expect(firstOfFive.items).toHaveLength(5);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(total);
    expect(await userLinks.countByUser(ANA)).toBe(50);
  });

  it('counts zero for a list with nothing in it', async () => {
    expect(await groupLinks.countByGroup(BACKEND)).toBe(0);
    expect(await userLinks.countByUser(ANA)).toBe(0);
  });
});
