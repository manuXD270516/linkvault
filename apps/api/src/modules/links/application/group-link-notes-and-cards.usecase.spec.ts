import { beforeEach, describe, expect, it } from 'vitest';
import {
  CommentsGroupNotFound,
  InvalidShareNote,
  LinkNotFound,
  NoteRemovalForbidden,
} from '../domain/errors';
import { ImportLinks } from './import-links.usecase';
import {
  ANA,
  BACKEND,
  BETO,
  CARLA,
  CommentsHarness,
  FRONTEND,
  STRANGER,
} from './testing/comments-test-harness';
import {
  InMemoryOutbox,
  TestPublicUrls,
} from './testing/links-test-doubles';

// La tarjeta del grupo (tareas 3.5 y 3.6), la nota al compartir (3.7), quitar la nota (3.8) y quitar un link con sus
// comentarios (3.9) de group-comments, con los dobles en memoria.

let harness: CommentsHarness;

/** Las URLs públicas de un test: los mismos orígenes que `.env.example`. */
const urls = new TestPublicUrls();

beforeEach(() => {
  harness = new CommentsHarness();
});

const url = (index: number) => `https://empresa.example/careers/${index}`;


describe('ListGroupLinks with notes and comments (3.5)', () => {
  it('Tarjeta con tres comentarios: count 3 and the two newest, newest first', async () => {
    const linkId = await harness.shared(BACKEND, ANA);
    await harness.comment(ANA, BACKEND, linkId, 'de Ana');
    await harness.comment(BETO, BACKEND, linkId, 'de Beto');
    await harness.comment(CARLA, BACKEND, linkId, 'de Carla');

    const page = await harness.listGroupLinks.execute(BETO, BACKEND, {
      limit: 20,
    });

    expect(page.items[0]?.comments).toMatchObject({
      count: 3,
      revision: 3,
      sharedAt: '2026-09-19T10:00:00.000Z',
    });
    expect(
      page.items[0]?.comments?.latest.map((comment) => [
        comment.author.displayName,
        comment.text,
      ]),
    ).toEqual([
      ['Carla', 'de Carla'],
      ['Beto', 'de Beto'],
    ]);
  });

  it('Link sin comentarios: count 0, nothing latest and revision 0', async () => {
    await harness.shared(BACKEND, ANA);

    const page = await harness.listGroupLinks.execute(ANA, BACKEND, {
      limit: 20,
    });

    expect(page.items[0]?.comments).toEqual({
      count: 0,
      revision: 0,
      sharedAt: '2026-09-19T10:00:00.000Z',
      latest: [],
    });
    expect(page.items[0]?.note).toBeUndefined();
  });

  it('La revisión crece con cada cambio: publish and delete leave count and add 2', async () => {
    const linkId = await harness.shared(BACKEND, ANA);
    const before = await harness.listGroupLinks.execute(ANA, BACKEND, {
      limit: 20,
    });
    const posted = await harness.comment(BETO, BACKEND, linkId);
    await harness.remove.execute(BETO, BACKEND, linkId, posted.comment.id);

    const after = await harness.listGroupLinks.execute(ANA, BACKEND, {
      limit: 20,
    });

    expect(after.items[0]?.comments?.count).toBe(
      before.items[0]?.comments?.count,
    );
    expect(after.items[0]?.comments?.revision).toBe(
      (before.items[0]?.comments?.revision ?? 0) + 2,
    );
  });

  it('Expulsado: the summary keeps the comment with authorLeft', async () => {
    const linkId = await harness.shared(BACKEND, ANA);
    await harness.comment(BETO, BACKEND, linkId);
    harness.membership.withoutMember(BACKEND, BETO);

    const page = await harness.listGroupLinks.execute(ANA, BACKEND, {
      limit: 20,
    });

    expect(page.items[0]?.comments?.latest[0]).toMatchObject({
      author: { userId: BETO, displayName: 'Beto' },
      authorLeft: true,
    });
  });

  it('carries the note of whoever shared it', async () => {
    await harness.shared(BACKEND, ANA, url(1), '  Esta es la que te dije ');

    const page = await harness.listGroupLinks.execute(BETO, BACKEND, {
      limit: 20,
    });

    expect(page.items[0]?.note).toEqual({
      text: 'Esta es la que te dije',
      createdAt: '2026-09-19T10:00:00.000Z',
    });
  });

  it('answers group_not_found to someone who is no longer a member', async () => {
    await harness.shared(BACKEND, ANA);
    harness.membership.withoutMember(BACKEND, BETO);

    await expect(
      harness.listGroupLinks.execute(BETO, BACKEND, { limit: 20 }),
    ).rejects.toMatchObject({ code: 'group_not_found' });
  });
});

describe('ListGroupLinks reads (3.6)', () => {
  /** Lecturas de cada puerto en una llamada al listado. */
  async function readsOf(limit: number): Promise<Record<string, number>> {
    harness.membership.memberIdsOfCalls = 0;
    harness.membership.membershipOfCalls = 0;
    harness.groupLinks.listByGroupCalls = 0;
    harness.groupLinks.countByGroupCalls = 0;
    harness.groupLinks.findCalls = 0;
    harness.comments.latestByLinksCalls = 0;
    harness.comments.pageCalls = 0;
    harness.comments.findCalls = 0;
    harness.directory.calls = 0;

    const page = await harness.listGroupLinks.execute(ANA, BACKEND, { limit });

    return {
      items: page.items.length,
      memberIdsOf: harness.membership.memberIdsOfCalls,
      membershipOf: harness.membership.membershipOfCalls,
      listByGroup: harness.groupLinks.listByGroupCalls,
      countByGroup: harness.groupLinks.countByGroupCalls,
      find: harness.groupLinks.findCalls,
      latestByLinks: harness.comments.latestByLinksCalls,
      commentPage: harness.comments.pageCalls,
      commentFind: harness.comments.findCalls,
      displayNamesOf: harness.directory.calls,
    };
  }

  it('Lecturas fijas: the same reads for a page of 2 links and one of 20, one per port', async () => {
    const authors = [ANA, BETO, CARLA];
    for (let index = 0; index < 20; index += 1) {
      const linkId = await harness.shared(
        BACKEND,
        authors[index % 3] ?? ANA,
        url(index),
      );
      // Distinto número de comentarios por link, de distintos autores.
      for (let count = 0; count < index % 4; count += 1) {
        await harness.comment(authors[count % 3] ?? ANA, BACKEND, linkId);
      }
    }

    const small = await readsOf(2);
    const large = await readsOf(20);

    const expected = {
      memberIdsOf: 1,
      membershipOf: 0,
      listByGroup: 1,
      countByGroup: 1,
      find: 0,
      latestByLinks: 1,
      commentPage: 0,
      commentFind: 0,
      displayNamesOf: 1,
    };
    expect(small).toMatchObject({ items: 2, ...expected });
    expect(large).toMatchObject({ items: 20, ...expected });
  });
});

describe('SaveLink with a note (3.7)', () => {
  it('Guardar con una nota: the relation keeps it, normalized, and the response carries it', async () => {
    const response = await harness.saveLink.execute(ANA, {
      url: url(1),
      groupId: BACKEND,
      note: '  Esta es la que te dije ',
    });

    expect(response.link.note).toEqual({
      text: 'Esta es la que te dije',
      createdAt: '2026-09-19T10:00:00.000Z',
    });
    expect(
      (await harness.groupLinks.find(BACKEND, response.link.id))?.note,
    ).toEqual({
      text: 'Esta es la que te dije',
      createdAt: new Date('2026-09-19T10:00:00.000Z'),
    });
  });

  it('La nota del primero se queda: already_there drops the second note without error', async () => {
    await harness.shared(BACKEND, ANA, url(1), 'Esta es la que te dije');
    harness.clock.advance(60_000);

    const second = await harness.saveLink.execute(BETO, {
      url: url(1),
      groupId: BACKEND,
      note: 'Yo también la vi',
    });

    expect(second.shared).toBe('already_there');
    expect(second.link.note?.text).toBe('Esta es la que te dije');
    expect(
      (await harness.groupLinks.find(BACKEND, second.link.id))?.note?.text,
    ).toBe('Esta es la que te dije');
  });

  it('treats an empty note as none, also without a group', async () => {
    const privately = await harness.saveLink.execute(ANA, {
      url: url(2),
      note: '   ',
    });
    const inGroup = await harness.saveLink.execute(ANA, {
      url: url(3),
      groupId: BACKEND,
      note: ' ',
    });

    expect(privately.link.note).toBeUndefined();
    expect(inGroup.link.note).toBeUndefined();
  });

  it('refuses a note with text but without a group, and one of 281 characters, naming note', async () => {
    await expect(
      harness.saveLink.execute(ANA, { url: url(4), note: 'Para mí' }),
    ).rejects.toBeInstanceOf(InvalidShareNote);
    await expect(
      harness.saveLink.execute(ANA, {
        url: url(5),
        groupId: BACKEND,
        note: 'a'.repeat(281),
      }),
    ).rejects.toBeInstanceOf(InvalidShareNote);
    expect(harness.links.size).toBe(0);
  });

  it('Importar no escribe notas', async () => {
    const importLinks = new ImportLinks(
      harness.links,
      harness.groupLinks,
      harness.userLinks,
      new InMemoryOutbox(),
      harness.membership,
      harness.directory,
      harness.limiter,
      urls,
      harness.clock,
    );
    const request = {
      text: `Mira ${url(6)}`,
      groupId: BACKEND,
      note: 'Esta es la que te dije',
    };

    const response = await importLinks.execute(ANA, request);

    expect(response.created).toBe(1);
    const linkId = response.links[0]?.id ?? '';
    expect((await harness.groupLinks.find(BACKEND, linkId))?.note).toBeUndefined();
  });
});

describe('RemoveShareNote (3.8)', () => {
  it('Quien compartió quita su nota', async () => {
    const linkId = await harness.shared(BACKEND, BETO, url(1), 'Mira');

    await harness.removeNote.execute(BETO, BACKEND, linkId);

    expect((await harness.groupLinks.find(BACKEND, linkId))?.note).toBeUndefined();
  });

  it('El propietario quita una nota ajena, and the link stays', async () => {
    const linkId = await harness.shared(BACKEND, BETO, url(1), 'Mira');

    await harness.removeNote.execute(ANA, BACKEND, linkId);

    const relation = await harness.groupLinks.find(BACKEND, linkId);
    expect(relation).not.toBeNull();
    expect(relation?.note).toBeUndefined();
  });

  it('Otro miembro no la quita: forbidden, and the note stays', async () => {
    const linkId = await harness.shared(BACKEND, BETO, url(1), 'Mira');

    await expect(
      harness.removeNote.execute(CARLA, BACKEND, linkId),
    ).rejects.toBeInstanceOf(NoteRemovalForbidden);
    expect((await harness.groupLinks.find(BACKEND, linkId))?.note?.text).toBe(
      'Mira',
    );
  });

  it('Quitar una nota que ya no está: it answers fine again', async () => {
    const linkId = await harness.shared(BACKEND, ANA, url(1), 'Mira');
    await harness.removeNote.execute(ANA, BACKEND, linkId);

    await expect(
      harness.removeNote.execute(ANA, BACKEND, linkId),
    ).resolves.toBeUndefined();
  });

  it('Sin permiso aunque no haya nota', async () => {
    const linkId = await harness.shared(BACKEND, BETO, url(1));

    await expect(
      harness.removeNote.execute(CARLA, BACKEND, linkId),
    ).rejects.toBeInstanceOf(NoteRemovalForbidden);
  });

  it('checks membership, then the relation, then the permission', async () => {
    const linkId = await harness.shared(BACKEND, BETO, url(1), 'Mira');

    await expect(
      harness.removeNote.execute(STRANGER, BACKEND, linkId),
    ).rejects.toBeInstanceOf(CommentsGroupNotFound);
    await expect(
      harness.removeNote.execute(CARLA, BACKEND, harness.unshared()),
    ).rejects.toBeInstanceOf(LinkNotFound);
  });

  it('answers link_not_found when the relation disappears while clearing', async () => {
    const linkId = await harness.shared(BACKEND, ANA, url(1), 'Mira');
    harness.groupLinks.clearNote = () => Promise.resolve(false);

    await expect(
      harness.removeNote.execute(ANA, BACKEND, linkId),
    ).rejects.toBeInstanceOf(LinkNotFound);
  });
});

describe('RemoveGroupLink with comments (3.9)', () => {
  it('Quitar la oferta se lleva sus comentarios, and only of that group', async () => {
    const linkId = await harness.shared(BACKEND, ANA, url(1), 'Mira');
    await harness.shared(
      FRONTEND,
      BETO,
      url(1),
    );
    await harness.comment(BETO, BACKEND, linkId);
    await harness.comment(CARLA, BACKEND, linkId);
    await harness.comment(BETO, FRONTEND, linkId);

    await harness.removeGroupLink.execute(ANA, BACKEND, linkId);

    expect(harness.comments.of(BACKEND, linkId)).toHaveLength(0);
    expect(
      harness.comments.of(FRONTEND, linkId),
    ).toHaveLength(1);
  });

  it('Volver a compartirla empieza de cero', async () => {
    const linkId = await harness.shared(BACKEND, ANA, url(1));
    await harness.comment(BETO, BACKEND, linkId);
    await harness.removeGroupLink.execute(ANA, BACKEND, linkId);
    harness.clock.advance(60_000);
    await harness.shared(BACKEND, BETO, url(1));

    const page = await harness.listGroupLinks.execute(ANA, BACKEND, {
      limit: 20,
    });

    expect(page.items[0]?.comments).toMatchObject({
      count: 0,
      revision: 0,
      latest: [],
      sharedAt: '2026-09-19T10:02:00.000Z',
    });
  });
});
