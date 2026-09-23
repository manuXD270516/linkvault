import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  ConstantPublicSlugGenerator,
  StubPublicSlugGenerator,
} from '../application/testing/stub-public-slug.generator';
import { jobLinkDraft } from '../application/testing/link-fixtures';
import {
  MAX_PUBLIC_SLUG_ATTEMPTS,
  PublicSlugExhausted,
} from '../domain/public-share';
import { isValidPublicSlug } from '../domain/public-slug';
import type { PublicSlugGenerator } from '../application/ports/public-slug-generator.port';
import {
  GROUP_LINK_MODEL_NAME,
  GROUP_LINKS_COLLECTION,
  JOB_LINK_MODEL_NAME,
  JOB_LINKS_COLLECTION,
} from './link.schemas';
import { GROUP_LINK_COMMENT_MODEL_NAME } from './group-link-comment.schemas';
import { MongoGroupLinkCommentRepository } from './mongo-group-link-comment.repository';
import { MongoGroupLinkRepository } from './mongo-group-link.repository';
import { MongoJobLinkRepository } from './mongo-job-link.repository';

// Adaptador Mongo del puerto GROUP_LINK_REPOSITORY (tarea 3.4 de job-links) contra el MongoMemoryReplSet del preset de
// @linkvault/testing. Compartir va dentro de la transacción del alta, como en producción.

let connection: Connection;
let links: MongoJobLinkRepository;
let groupLinks: MongoGroupLinkRepository;
let slugs: StubPublicSlugGenerator;

const ANA = new mongoose.Types.ObjectId().toHexString();
const BETO = new mongoose.Types.ObjectId().toHexString();
const BACKEND = new mongoose.Types.ObjectId().toHexString();
const FRONTEND = new mongoose.Types.ObjectId().toHexString();
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const SEARCH_PAGE =
  'https://www.linkedin.com/jobs/search/?currentJobId=3811111111';
const OTHER_JOB = 'https://www.linkedin.com/jobs/view/3822222222/';
/** Slug libre que ningún otro escenario de este archivo usa. */
const FREE_SLUG = 'k7m2p9r4t6vw';
const now = new Date('2026-09-17T10:00:00.000Z');
const later = new Date('2026-09-17T11:00:00.000Z');

/** Guarda la URL y la comparte en el grupo, todo en la misma transacción, como hará `save-link`. */
function shareLink(
  url: string,
  groupId: string,
  sharedBy: string,
  sharedAt = now,
  options: { publish?: boolean; repository?: MongoGroupLinkRepository } = {},
) {
  const repository = options.repository ?? groupLinks;
  return links.withResolvedLink(
    jobLinkDraft(url, { createdBy: sharedBy, now: sharedAt }),
    async (resolved, session) => {
      const shared = await repository.share(
        {
          groupId,
          linkId: resolved.link.id,
          sharedBy,
          sharedAt,
          ...(options.publish === undefined ? {} : { publish: options.publish }),
        },
        session,
      );
      return { linkId: resolved.link.id, ...shared };
    },
  );
}

/** Otro adaptador sobre la misma conexión, con su propio generador de slugs. */
function repositoryWith(generator: PublicSlugGenerator) {
  return new MongoGroupLinkRepository(
    connection,
    new MongoGroupLinkCommentRepository(connection),
    generator,
  );
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `links-${randomUUID()}` })
    .asPromise();
  links = new MongoJobLinkRepository(connection);
  slugs = new StubPublicSlugGenerator();
  groupLinks = new MongoGroupLinkRepository(
    connection,
    new MongoGroupLinkCommentRepository(connection),
    slugs,
  );
  await connection.model(JOB_LINK_MODEL_NAME).init();
  await connection.model(GROUP_LINK_MODEL_NAME).init();
  await connection.model(GROUP_LINK_COMMENT_MODEL_NAME).init();
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
      commentCount: 0,
      commentsRevision: 0,
      knowSomeoneUserIds: [],
      tags: [],
      pinned: false,
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

describe('removeWithComments and deleteByGroup', () => {
  it('Quitar no destruye la vacante', async () => {
    const { linkId } = await shareLink(JOB_PAGE, BACKEND, ANA);
    await shareLink(SEARCH_PAGE, FRONTEND, ANA, later);

    expect(await groupLinks.removeWithComments(BACKEND, linkId)).toBe(true);
    expect(await groupLinks.find(BACKEND, linkId)).toBeNull();
    expect((await groupLinks.listByGroup(FRONTEND, { limit: 20 })).items).toHaveLength(
      1,
    );
    expect(await links.findById(linkId)).not.toBeNull();
  });

  it('answers false when the link was not in that group', async () => {
    const { linkId } = await shareLink(JOB_PAGE, BACKEND, ANA);

    expect(await groupLinks.removeWithComments(FRONTEND, linkId)).toBe(false);
    expect(await groupLinks.removeWithComments('no-es-un-id', linkId)).toBe(
      false,
    );
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

// Enlace público de una relación (tareas 3.6 a 3.11 de public-preview-share). El slug lo sortea el repositorio y su
// unicidad la garantiza el índice único parcial: aquí se prueban los dos caminos de escritura y sus reintentos.
describe('publish y unpublish', () => {
  it('Publicar', async () => {
    const shared = await shareLink(JOB_PAGE, BACKEND, ANA);

    const published = await groupLinks.publish(
      BACKEND,
      shared.linkId,
      ANA,
      later,
    );

    expect(published).not.toBeNull();
    expect(isValidPublicSlug(published?.slug ?? '')).toBe(true);
    expect(published?.publishedBy).toBe(ANA);
    expect(published?.publishedAt).toEqual(later);
    await expect(
      groupLinks.find(BACKEND, shared.linkId),
    ).resolves.toMatchObject({ publicShare: published });
  });

  it('Publicar dos veces no cambia el enlace', async () => {
    const shared = await shareLink(JOB_PAGE, BACKEND, ANA);
    const first = await groupLinks.publish(BACKEND, shared.linkId, ANA, later);

    const second = await groupLinks.publish(BACKEND, shared.linkId, BETO, now);

    expect(second).toEqual(first);
  });

  it('Despublicar quema el enlace', async () => {
    const shared = await shareLink(JOB_PAGE, BACKEND, ANA);
    const first = await groupLinks.publish(BACKEND, shared.linkId, ANA, later);

    await expect(groupLinks.unpublish(BACKEND, shared.linkId)).resolves.toBe(
      true,
    );

    await expect(
      groupLinks.findByPublicSlug(first?.slug ?? ''),
    ).resolves.toBeNull();
    const again = await groupLinks.publish(BACKEND, shared.linkId, ANA, later);
    expect(again?.slug).not.toBe(first?.slug);
  });

  it('Despublicar lo que no estaba publicado', async () => {
    const shared = await shareLink(JOB_PAGE, BACKEND, ANA);

    await expect(groupLinks.unpublish(BACKEND, shared.linkId)).resolves.toBe(
      true,
    );
    await expect(
      groupLinks.find(BACKEND, shared.linkId),
    ).resolves.not.toHaveProperty('publicShare');
  });

  it.each([
    [
      'una relación inexistente',
      () => new mongoose.Types.ObjectId().toHexString(),
    ],
    ['un identificador mal formado', () => 'no-es-un-id'],
  ])('Publicar sobre %s', async (_case, of) => {
    await expect(
      groupLinks.publish(BACKEND, of(), ANA, later),
    ).resolves.toBeNull();
    await expect(groupLinks.unpublish(BACKEND, of())).resolves.toBe(false);
  });

  it('Slug repetido al publicar', async () => {
    const taken = await shareLink(JOB_PAGE, BACKEND, ANA);
    const other = await shareLink(OTHER_JOB, FRONTEND, ANA);
    const first = await groupLinks.publish(BACKEND, taken.linkId, ANA, later);
    const repeating = repositoryWith(
      new StubPublicSlugGenerator([first?.slug ?? '', FREE_SLUG]),
    );

    const published = await repeating.publish(
      FRONTEND,
      other.linkId,
      ANA,
      later,
    );

    expect(published?.slug).toBe(FREE_SLUG);
  });

  it('Un generador que siempre repite agota los intentos', async () => {
    const taken = await shareLink(JOB_PAGE, BACKEND, ANA);
    const other = await shareLink(OTHER_JOB, FRONTEND, ANA);
    const first = await groupLinks.publish(BACKEND, taken.linkId, ANA, later);
    const constant = new ConstantPublicSlugGenerator(first?.slug ?? '');

    await expect(
      repositoryWith(constant).publish(FRONTEND, other.linkId, ANA, later),
    ).rejects.toBeInstanceOf(PublicSlugExhausted);
    expect(constant.calls).toBe(MAX_PUBLIC_SLUG_ATTEMPTS);
  });

  /**
   * El enlace público pertenece a la **relación**, no a la vacante (D1): la misma oferta compartida en dos grupos
   * tiene dos interruptores independientes, y apagar uno no toca al otro.
   */
  it('Dos grupos, dos enlaces', async () => {
    const inA = await shareLink(JOB_PAGE, BACKEND, ANA);
    const inB = await shareLink(SEARCH_PAGE, FRONTEND, BETO, later);
    // La misma vacante: una sola `JobLink` y dos relaciones.
    expect(inB.linkId).toBe(inA.linkId);

    const a = await groupLinks.publish(BACKEND, inA.linkId, ANA, later);
    const b = await groupLinks.publish(FRONTEND, inB.linkId, BETO, later);

    expect(a?.slug).not.toBe(b?.slug);
    await expect(
      groupLinks.findByPublicSlug(a?.slug ?? ''),
    ).resolves.toMatchObject({ groupId: BACKEND });
    await expect(
      groupLinks.findByPublicSlug(b?.slug ?? ''),
    ).resolves.toMatchObject({ groupId: FRONTEND });

    // Despublicar el de A no afecta al de B.
    await groupLinks.unpublish(BACKEND, inA.linkId);

    await expect(
      groupLinks.findByPublicSlug(a?.slug ?? ''),
    ).resolves.toBeNull();
    await expect(
      groupLinks.findByPublicSlug(b?.slug ?? ''),
    ).resolves.toMatchObject({ groupId: FRONTEND });
    await expect(
      groupLinks.find(FRONTEND, inB.linkId),
    ).resolves.toMatchObject({ publicShare: b });
  });

  it('Dos publicaciones a la vez dejan un solo slug vivo', async () => {
    const shared = await shareLink(JOB_PAGE, BACKEND, ANA);

    const [first, second] = await Promise.all([
      groupLinks.publish(BACKEND, shared.linkId, ANA, later),
      groupLinks.publish(BACKEND, shared.linkId, BETO, later),
    ]);

    expect(first).toEqual(second);
    expect(
      await connection
        .collection(GROUP_LINKS_COLLECTION)
        .countDocuments({ 'publicShare.slug': { $exists: true } }),
    ).toBe(1);
  });
});

describe('share con publish', () => {
  it('Guardar en un grupo que comparte en público', async () => {
    const shared = await shareLink(JOB_PAGE, BACKEND, ANA, now, {
      publish: true,
    });

    expect(shared.created).toBe(true);
    expect(isValidPublicSlug(shared.relation.publicShare?.slug ?? '')).toBe(
      true,
    );
    expect(shared.relation.publicShare?.publishedBy).toBe(ANA);
  });

  it('El enlace público del primero se queda', async () => {
    const first = await shareLink(JOB_PAGE, BACKEND, ANA, now, {
      publish: true,
    });
    await groupLinks.unpublish(BACKEND, first.linkId);

    const second = await shareLink(SEARCH_PAGE, BACKEND, BETO, later, {
      publish: true,
    });

    expect(second.created).toBe(false);
    expect(second.relation.publicShare).toBeUndefined();
  });

  it('Slug repetido al compartir', async () => {
    const taken = await shareLink(JOB_PAGE, BACKEND, ANA, now, {
      publish: true,
    });
    const busy = taken.relation.publicShare?.slug ?? '';
    // El primer intento de la transacción choca con el índice del slug; `withResolvedLink` la repite entera y el
    // segundo sortea otro slug. Dentro de `share` no se reintenta: la sesión ya está abortada.
    const repeating = repositoryWith(
      new StubPublicSlugGenerator([busy, FREE_SLUG]),
    );

    const shared = await shareLink(OTHER_JOB, FRONTEND, ANA, later, {
      publish: true,
      repository: repeating,
    });

    expect(shared.relation.publicShare?.slug).toBe(FREE_SLUG);
    expect(await groupLinks.countByGroup(FRONTEND)).toBe(1);
    await expect(groupLinks.findByPublicSlug(busy)).resolves.toMatchObject({
      linkId: taken.linkId,
    });
  });
});

describe('findByPublicSlug', () => {
  it('encuentra la relación publicada por el índice del slug', async () => {
    const shared = await shareLink(JOB_PAGE, BACKEND, ANA);
    const published = await groupLinks.publish(
      BACKEND,
      shared.linkId,
      ANA,
      later,
    );

    const found = await groupLinks.findByPublicSlug(published?.slug ?? '');

    expect(found?.linkId).toBe(shared.linkId);
    expect(found?.groupId).toBe(BACKEND);
  });

  it.each([
    ['uno inexistente', 'zzzzzzzzzzzz'],
    ['uno mal formado', 'NO-ES-UN-SLUG'],
  ])('responde null con %s', async (_case, slug) => {
    await expect(groupLinks.findByPublicSlug(slug)).resolves.toBeNull();
  });

  it('Slug con otra caja', async () => {
    const shared = await shareLink(JOB_PAGE, BACKEND, ANA);
    const published = await groupLinks.publish(
      BACKEND,
      shared.linkId,
      ANA,
      later,
    );

    await expect(
      groupLinks.findByPublicSlug((published?.slug ?? '').toUpperCase()),
    ).resolves.toBeNull();
  });

  it('va por el índice único parcial, sin recorrer la colección', async () => {
    const shared = await shareLink(JOB_PAGE, BACKEND, ANA);
    const published = await groupLinks.publish(
      BACKEND,
      shared.linkId,
      ANA,
      later,
    );
    const plan: unknown = await connection
      .collection(GROUP_LINKS_COLLECTION)
      .find({ 'publicShare.slug': published?.slug })
      .explain('queryPlanner');

    expect(JSON.stringify(plan)).toContain('"publicShare.slug":1');
    expect(JSON.stringify(plan)).not.toContain('COLLSCAN');
  });
});

describe('el enlace público en los listados', () => {
  it('Enlace público en el listado del grupo', async () => {
    const published = await shareLink(JOB_PAGE, BACKEND, ANA);
    await shareLink(OTHER_JOB, BACKEND, ANA, later);
    const share = await groupLinks.publish(
      BACKEND,
      published.linkId,
      ANA,
      later,
    );

    const page = await groupLinks.listByGroup(BACKEND, { limit: 20 });

    const listed = page.items.find((item) => item.link.id === published.linkId);
    const unpublished = page.items.find(
      (item) => item.link.id !== published.linkId,
    );
    expect(listed?.inGroup?.publicShare).toEqual(share);
    expect(unpublished?.inGroup?.publicShare).toBeUndefined();
  });
});

describe('el enlace público vive con la relación', () => {
  it('Quitar quema el enlace público', async () => {
    const shared = await shareLink(JOB_PAGE, BACKEND, ANA);
    const published = await groupLinks.publish(
      BACKEND,
      shared.linkId,
      ANA,
      later,
    );

    await expect(
      groupLinks.removeWithComments(BACKEND, shared.linkId),
    ).resolves.toBe(true);

    await expect(
      groupLinks.findByPublicSlug(published?.slug ?? ''),
    ).resolves.toBeNull();
  });

  it('El grupo se borra', async () => {
    const first = await shareLink(JOB_PAGE, BACKEND, ANA);
    const second = await shareLink(OTHER_JOB, BACKEND, ANA, later);
    const one = await groupLinks.publish(BACKEND, first.linkId, ANA, later);
    const two = await groupLinks.publish(BACKEND, second.linkId, ANA, later);

    const session = await connection.startSession();
    try {
      await session.withTransaction(() =>
        groupLinks.deleteByGroup(BACKEND, session),
      );
    } finally {
      await session.endSession();
    }

    await expect(
      groupLinks.findByPublicSlug(one?.slug ?? ''),
    ).resolves.toBeNull();
    await expect(
      groupLinks.findByPublicSlug(two?.slug ?? ''),
    ).resolves.toBeNull();
  });

  it('Volver a compartir no resucita el enlace', async () => {
    const first = await shareLink(JOB_PAGE, BACKEND, ANA, now, {
      publish: true,
    });
    const burnt = first.relation.publicShare?.slug ?? '';
    await groupLinks.removeWithComments(BACKEND, first.linkId);

    const again = await shareLink(JOB_PAGE, BACKEND, BETO, later, {
      publish: true,
    });

    expect(again.relation.publicShare?.slug).not.toBe(burnt);
    await expect(groupLinks.findByPublicSlug(burnt)).resolves.toBeNull();
  });
});

describe('setKnowSomeone (know-someone-flag)', () => {
  it('adds and pulls atomically without duplicates', async () => {
    const { linkId } = await shareLink(JOB_PAGE, BACKEND, ANA);

    expect(
      await groupLinks.setKnowSomeone(BACKEND, linkId, ANA, true),
    ).toEqual({ flaggedByMe: true, count: 1 });
    expect(
      await groupLinks.setKnowSomeone(BACKEND, linkId, ANA, true),
    ).toEqual({ flaggedByMe: true, count: 1 });
    expect(
      await groupLinks.setKnowSomeone(BACKEND, linkId, BETO, true),
    ).toEqual({ flaggedByMe: true, count: 2 });
    expect(
      await groupLinks.setKnowSomeone(BACKEND, linkId, ANA, false),
    ).toEqual({ flaggedByMe: false, count: 1 });

    const relation = await groupLinks.find(BACKEND, linkId);
    expect(relation?.knowSomeoneUserIds).toEqual([BETO]);
  });

  it('answers null when the relation is missing', async () => {
    expect(
      await groupLinks.setKnowSomeone(
        BACKEND,
        new mongoose.Types.ObjectId().toHexString(),
        ANA,
        true,
      ),
    ).toBeNull();
  });
});

describe('setTags and setPinned (group-link-tags-pinned)', () => {
  it('replaces tags with $set and pins atomically', async () => {
    const { linkId } = await shareLink(JOB_PAGE, BACKEND, ANA);

    expect(await groupLinks.setTags(BACKEND, linkId, ['remote', 'backend'])).toEqual([
      'remote',
      'backend',
    ]);
    expect(await groupLinks.setTags(BACKEND, linkId, [])).toEqual([]);
    expect(await groupLinks.setPinned(BACKEND, linkId, true)).toBe(true);
    expect(await groupLinks.setPinned(BACKEND, linkId, false)).toBe(false);

    const relation = await groupLinks.find(BACKEND, linkId);
    expect(relation?.tags).toEqual([]);
    expect(relation?.pinned).toBe(false);
  });

  it('filters list and count by pinned and tag with the same match', async () => {
    const first = await shareLink(JOB_PAGE, BACKEND, ANA);
    const second = await shareLink(OTHER_JOB, BACKEND, BETO, later);
    await groupLinks.setPinned(BACKEND, first.linkId, true);
    await groupLinks.setTags(BACKEND, second.linkId, ['remote']);

    const pinnedPage = await groupLinks.listByGroup(BACKEND, {
      limit: 20,
      pinned: true,
    });
    expect(pinnedPage.items.map((item) => item.link.id)).toEqual([first.linkId]);
    expect(await groupLinks.countByGroup(BACKEND, { limit: 20, pinned: true })).toBe(
      1,
    );

    const unpinnedPage = await groupLinks.listByGroup(BACKEND, {
      limit: 20,
      pinned: false,
    });
    expect(unpinnedPage.items.map((item) => item.link.id)).toEqual([
      second.linkId,
    ]);
    expect(
      await groupLinks.countByGroup(BACKEND, { limit: 20, pinned: false }),
    ).toBe(1);

    const taggedPage = await groupLinks.listByGroup(BACKEND, {
      limit: 20,
      tag: 'remote',
    });
    expect(taggedPage.items.map((item) => item.link.id)).toEqual([
      second.linkId,
    ]);
    expect(
      await groupLinks.countByGroup(BACKEND, { limit: 20, tag: 'remote' }),
    ).toBe(1);
  });

  it('answers null when the relation is missing', async () => {
    const missing = new mongoose.Types.ObjectId().toHexString();
    expect(await groupLinks.setTags(BACKEND, missing, ['a'])).toBeNull();
    expect(await groupLinks.setPinned(BACKEND, missing, true)).toBeNull();
  });
});
