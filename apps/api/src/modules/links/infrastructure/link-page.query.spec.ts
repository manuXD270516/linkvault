import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  jobLinkSchema,
} from './link.schemas';
import { MongoGroupLinkCommentRepository } from './mongo-group-link-comment.repository';
import { MongoGroupLinkRepository } from './mongo-group-link.repository';
import { MongoUserLinkRepository } from './mongo-user-link.repository';

// Paginación por cursor opaco `(fecha, _id)` y `total` por conteo (tarea 3.6 de job-links), compartidos por el listado
// de un grupo y por la lista privada, contra el MongoMemoryReplSet del preset de @linkvault/testing.
//
// Los 50 links se siembran **una sola vez** y con una escritura por colección: lo que se prueba aquí es cómo se recorren
// y se cuentan, no cómo se guardan (eso son las tareas 3.3 a 3.5, con sus transacciones reales). Hacerlo con 50
// transacciones por test tardaba lo bastante como para pasarse del `testTimeout` de Vitest dentro de la suite completa,
// y un test que expira a mitad de escritura deja la base a medias para el siguiente. Como ningún test de este archivo
// escribe, la siembra vale para todos y no hace falta limpiar entre ellos.

let connection: Connection;
let groupLinks: MongoGroupLinkRepository;
let userLinks: MongoUserLinkRepository;
/** Ids de los 50 links sembrados, en el orden en que se crearon. */
let saved: string[];

const ANA = new mongoose.Types.ObjectId();
const BACKEND = new mongoose.Types.ObjectId();
/** Grupo y usuario sin nada guardado, para los listados vacíos. */
const EMPTY_GROUP = new mongoose.Types.ObjectId().toHexString();
const NOBODY = new mongoose.Types.ObjectId().toHexString();
/** Todas con la misma fecha: es el caso de una importación de 50 links, donde solo desempata el `_id`. */
const AT_ONCE = new Date('2026-09-17T10:00:00.000Z');
const TOTAL = 50;

/** Siembra 50 vacantes distintas, compartidas en el grupo y guardadas en la lista privada, todas en el mismo instante. */
async function seedFifty(): Promise<string[]> {
  const jobLinks = [];
  const relations = [];
  const entries = [];
  for (let index = 0; index < TOTAL; index += 1) {
    const linkId = new mongoose.Types.ObjectId();
    // El borrador es el mismo que produce el caso de uso: URL normalizada, hash y clave de dedupe de verdad.
    const draft = jobLinkDraft(`https://empresa.example/careers/${index}`, {
      createdBy: ANA.toHexString(),
      now: AT_ONCE,
    });
    jobLinks.push({
      _id: linkId,
      normalizedUrl: draft.normalizedUrl,
      urlHash: draft.urlHash,
      dedupeKey: draft.dedupeKey,
      platform: draft.platform,
      displayUrl: draft.displayUrl,
      originalUrls: [...draft.originalUrls],
      previewStatus: draft.previewStatus,
      previewVersion: draft.previewVersion,
      createdBy: ANA,
      createdAt: AT_ONCE,
      updatedAt: AT_ONCE,
    });
    relations.push({
      groupId: BACKEND,
      linkId,
      sharedBy: ANA,
      sharedAt: AT_ONCE,
    });
    entries.push({ userId: ANA, linkId, savedAt: AT_ONCE });
  }
  await connection.collection(JOB_LINKS_COLLECTION).insertMany(jobLinks);
  await connection.collection(GROUP_LINKS_COLLECTION).insertMany(relations);
  await connection.collection(USER_LINKS_COLLECTION).insertMany(entries);
  return jobLinks.map((document) => document._id.toHexString());
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
  groupLinks = new MongoGroupLinkRepository(
    connection,
    new MongoGroupLinkCommentRepository(connection),
  );
  userLinks = new MongoUserLinkRepository(connection);
  // Los dos repositorios registran sus modelos; el de las vacantes se registra aquí, porque aquí no se guardan por su
  // repositorio: se siembran de una vez.
  connection.model(JOB_LINK_MODEL_NAME, jobLinkSchema);
  await connection.model(JOB_LINK_MODEL_NAME).init();
  await connection.model(GROUP_LINK_MODEL_NAME).init();
  await connection.model(USER_LINK_MODEL_NAME).init();
  saved = await seedFifty();
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('Paginación sin saltos ni repetidos', () => {
  it('walks 50 links of a group in pages of 20, seeing each one exactly once', async () => {
    const seen = await walk(
      (query) => groupLinks.listByGroup(BACKEND.toHexString(), toLinkListQuery(query)),
      20,
    );

    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL);
    expect(new Set(seen)).toEqual(new Set(saved));
  });

  it('walks the private list the same way', async () => {
    const seen = await walk(
      (query) => userLinks.listByUser(ANA.toHexString(), toLinkListQuery(query)),
      20,
    );

    expect(seen).toHaveLength(TOTAL);
    expect(new Set(seen)).toEqual(new Set(saved));
  });

  it('gives the same order no matter the page size', async () => {
    const byTwenty = await walk(
      (query) => groupLinks.listByGroup(BACKEND.toHexString(), toLinkListQuery(query)),
      20,
    );
    const bySeven = await walk(
      (query) => groupLinks.listByGroup(BACKEND.toHexString(), toLinkListQuery(query)),
      7,
    );

    expect(bySeven).toEqual(byTwenty);
  });

  it('has no next cursor on the last page', async () => {
    const page = await groupLinks.listByGroup(BACKEND.toHexString(), {
      limit: 50,
    });

    expect(page.items).toHaveLength(TOTAL);
    expect(page.nextCursor).toBeUndefined();
  });
});

describe('total', () => {
  it('does not depend on the page size', async () => {
    const total = await groupLinks.countByGroup(BACKEND.toHexString());
    const firstOfTwenty = await groupLinks.listByGroup(BACKEND.toHexString(), {
      limit: 20,
    });
    const firstOfFive = await groupLinks.listByGroup(BACKEND.toHexString(), {
      limit: 5,
    });

    expect(total).toBe(TOTAL);
    expect(firstOfTwenty.items).toHaveLength(20);
    expect(firstOfFive.items).toHaveLength(5);
    expect(await groupLinks.countByGroup(BACKEND.toHexString())).toBe(total);
    expect(await userLinks.countByUser(ANA.toHexString())).toBe(TOTAL);
  });

  it('counts zero for a list with nothing in it', async () => {
    expect(await groupLinks.countByGroup(EMPTY_GROUP)).toBe(0);
    expect((await groupLinks.listByGroup(EMPTY_GROUP, { limit: 20 })).items).toEqual(
      [],
    );
    expect(await userLinks.countByUser(NOBODY)).toBe(0);
    expect((await userLinks.listByUser(NOBODY, { limit: 20 })).items).toEqual([]);
  });
});
