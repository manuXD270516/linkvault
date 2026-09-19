import {
  apiErrorResponseSchema,
  commentPageSchema,
  createCommentResponseSchema,
  deleteCommentResponseSchema,
  linkPageSchema,
  type CreateCommentResponse,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCommentsTestApp,
  type CommentsTestApp,
} from '../../../test-support/comments-test-app';
import { GROUP_LINK_COMMENTS_COLLECTION } from '../infrastructure/group-link-comment.schemas';
import { GROUP_LINKS_COLLECTION } from '../infrastructure/link.schemas';

// Comentarios por HTTP (tareas 5.2, 5.3, 5.4 y 5.6 de group-comments) contra la app completa y el replica set del
// preset. La suite no levanta Redis: publicar el aviso falla enseguida, que es el escenario "Redis caído al comentar".

const NULL_CHAR = String.fromCharCode(0);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);

let fx: CommentsTestApp;

beforeAll(async () => {
  fx = await createCommentsTestApp('comments-http', getMongoTestUri());
});

afterAll(async () => {
  await fx.close();
});

function created(response: {
  statusCode: number;
  json: () => unknown;
}): CreateCommentResponse {
  expect(response.statusCode).toBe(201);
  return createCommentResponseSchema.parse(response.json());
}

function errorOf(response: { json: () => unknown }) {
  return apiErrorResponseSchema.parse(response.json());
}

describe('POST /api/groups/:id/links/:linkId/comments (5.2)', () => {
  it('Comentar una oferta del grupo', async () => {
    const linkId = await fx.newLink();

    const response = created(await fx.post(fx.beto, linkId, 'Piden inglés C1'));

    expect(response.comment).toMatchObject({
      author: { userId: fx.beto.userId, displayName: 'Beto' },
      authorLeft: false,
      text: 'Piden inglés C1',
    });
    expect(response.comments).toMatchObject({ count: 1, revision: 1 });
    expect(response.comments.latest).toEqual([response.comment]);
  });

  it('Extraño no comenta: three identical 404 group_not_found and nothing stored', async () => {
    const linkId = await fx.newLink();

    const responses = [
      await fx.post(fx.stranger, linkId, 'Hola'),
      await fx.post(fx.stranger, linkId, 'Hola', '66e9a00000000000000000ff'),
      await fx.post(fx.stranger, linkId, 'Hola', 'no-es-un-id'),
    ];

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(errorOf(response).code).toBe('group_not_found');
    }
    expect(new Set(responses.map((response) => response.body)).size).toBe(1);
    expect(await fx.storedComments(linkId)).toBe(0);
  });

  it('Link que no está en el grupo: 404 link_not_found, also for a malformed id', async () => {
    const other = await fx.http.createGroup(fx.beto, 'Otro');
    const elsewhere = await fx.save(
      fx.beto,
      'https://empresa.example/careers/solo-en-otro',
      { groupId: other.id },
    );

    for (const linkId of [elsewhere.link.id, 'no-es-un-id']) {
      const response = await fx.post(fx.ana, linkId, 'Hola');
      expect(response.statusCode).toBe(404);
      expect(errorOf(response).code).toBe('link_not_found');
    }
  });

  it('Comentario vacío: 400 naming text', async () => {
    const linkId = await fx.newLink();

    const response = await fx.post(fx.beto, linkId, '   ');

    expect(response.statusCode).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'validation_error',
      fields: ['text'],
    });
  });

  it('Comentario demasiado largo: 400 naming text, nothing stored', async () => {
    const linkId = await fx.newLink();

    const response = await fx.post(fx.beto, linkId, 'a'.repeat(501));

    expect(response.statusCode).toBe(400);
    expect(errorOf(response)).toMatchObject({ fields: ['text'] });
    expect(await fx.storedComments(linkId)).toBe(0);
  });

  it('Justo en el límite: 500 characters surrounded by spaces', async () => {
    const linkId = await fx.newLink();

    const response = created(
      await fx.post(fx.beto, linkId, `   ${'a'.repeat(500)}   `),
    );

    expect(response.comment.text).toBe('a'.repeat(500));
  });

  it('HTML como texto: answered and threaded exactly as written', async () => {
    const linkId = await fx.newLink();
    const html = '<b>ojo</b> <script>alert(1)</script>';

    const response = created(await fx.post(fx.beto, linkId, html));
    const thread = commentPageSchema.parse(
      (await fx.thread(fx.ana, linkId)).json(),
    );

    expect(response.comment.text).toBe(html);
    expect(thread.items[0]?.text).toBe(html);
  });

  it('Caracteres invisibles fuera', async () => {
    const linkId = await fx.newLink();

    created(
      await fx.post(
        fx.beto,
        linkId,
        `uno\r\ndos${NULL_CHAR} tres${RIGHT_TO_LEFT_OVERRIDE}`,
      ),
    );
    const stored = await fx.http.connection
      .collection(GROUP_LINK_COMMENTS_COLLECTION)
      .findOne({ linkId: new mongoose.Types.ObjectId(linkId) });

    expect(stored?.['text']).toBe('uno\ndos tres');
  });

  it('Un teléfono se conserva', async () => {
    const linkId = await fx.newLink();

    const response = created(
      await fx.post(
        fx.beto,
        linkId,
        'Escríbele a Juan de RRHH al +591 70000000',
      ),
    );

    expect(response.comment.text).toContain('+591 70000000');
  });

  it('Redis caído al comentar: 201, and the comment is in the thread', async () => {
    const linkId = await fx.newLink();

    created(await fx.post(fx.beto, linkId, 'Sin Redis'));
    const thread = commentPageSchema.parse(
      (await fx.thread(fx.ana, linkId)).json(),
    );

    expect(thread.items.map((comment) => comment.text)).toEqual(['Sin Redis']);
  });
});

describe('GET /api/groups/:id/links/:linkId/comments (5.3)', () => {
  it('Hilo paginado sin saltos ni repetidos: 45 comments, 30 at the same instant', async () => {
    const linkId = await fx.newLink();
    const sameInstant = new Date('2026-09-19T10:00:00.000Z');
    await fx.http.connection.collection(GROUP_LINK_COMMENTS_COLLECTION).insertMany(
      Array.from({ length: 45 }, (_, index) => ({
        _id: new mongoose.Types.ObjectId(),
        groupId: new mongoose.Types.ObjectId(fx.group.id),
        linkId: new mongoose.Types.ObjectId(linkId),
        authorId: new mongoose.Types.ObjectId(fx.beto.userId),
        text: `c${index}`,
        createdAt:
          index < 30
            ? sameInstant
            : new Date(sameInstant.getTime() + index * 1000),
      })),
    );
    await fx.http.connection
      .collection(GROUP_LINKS_COLLECTION)
      .updateOne(
        {
          groupId: new mongoose.Types.ObjectId(fx.group.id),
          linkId: new mongoose.Types.ObjectId(linkId),
        },
        { $set: { commentCount: 45, commentsRevision: 45 } },
      );

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const response = await fx.thread(
        fx.ana,
        linkId,
        `?limit=20${cursor === undefined ? '' : `&cursor=${cursor}`}`,
      );
      expect(response.statusCode).toBe(200);
      const page = commentPageSchema.parse(response.json());
      expect(page.total).toBe(45);
      seen.push(...page.items.map((comment) => comment.id));
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    expect(seen).toHaveLength(45);
    expect(new Set(seen).size).toBe(45);
  });

  it('Cada grupo tiene su hilo', async () => {
    const url = 'https://empresa.example/careers/dos-grupos';
    const a = await fx.save(fx.ana, url, { groupId: fx.group.id });
    const b = await fx.http.createGroup(fx.ana, 'Grupo B');
    await fx.save(fx.ana, url, { groupId: b.id });
    created(await fx.post(fx.ana, a.link.id, 'En A'));

    const response = await fx.thread(fx.ana, a.link.id, '', b.id);

    expect(response.statusCode).toBe(200);
    expect(commentPageSchema.parse(response.json())).toEqual({
      items: [],
      total: 0,
    });
  });

  it('Extraño no lee el hilo, although he has the link in his private list', async () => {
    const linkId = await fx.newLink();
    const url = (
      await fx.http.request('GET', `/api/groups/${fx.group.id}/links`, {
        authorization: fx.ana.authorization,
      })
    )
      .json<{ items: { id: string; displayUrl: string }[] }>()
      .items.find((item) => item.id === linkId)?.displayUrl;
    await fx.save(fx.stranger, url ?? '');

    const response = await fx.thread(fx.stranger, linkId);

    expect(response.statusCode).toBe(404);
    expect(errorOf(response).code).toBe('group_not_found');
  });

  it('answers link_not_found for a link that is not in the group', async () => {
    const response = await fx.thread(fx.ana, '66e9a00000000000000000ee');

    expect(response.statusCode).toBe(404);
    expect(errorOf(response).code).toBe('link_not_found');
  });

  it('rejects a manipulated cursor with 400 naming cursor', async () => {
    const linkId = await fx.newLink();

    const response = await fx.thread(fx.ana, linkId, '?cursor=roto');

    expect(response.statusCode).toBe(400);
    expect(errorOf(response)).toMatchObject({
      code: 'validation_error',
      fields: ['cursor'],
    });
  });
});

describe('DELETE /api/groups/:id/links/:linkId/comments/:commentId (5.4)', () => {
  it('Borrar el propio: 200 with count 1, and gone from the thread', async () => {
    const linkId = await fx.newLink();
    created(await fx.post(fx.ana, linkId, 'de Ana'));
    const mine = created(await fx.post(fx.beto, linkId, 'de Beto'));

    const response = await fx.remove(fx.beto, linkId, mine.comment.id);

    expect(response.statusCode).toBe(200);
    expect(deleteCommentResponseSchema.parse(response.json()).comments.count).toBe(1);
    const thread = commentPageSchema.parse(
      (await fx.thread(fx.ana, linkId)).json(),
    );
    expect(thread.total).toBe(1);
    expect(thread.items.map((comment) => comment.id)).not.toContain(
      mine.comment.id,
    );
  });

  it('El propietario borra un comentario ajeno, without a trace', async () => {
    const linkId = await fx.newLink();
    const theirs = created(await fx.post(fx.beto, linkId, 'de Beto'));

    const response = await fx.remove(fx.ana, linkId, theirs.comment.id);

    expect(response.statusCode).toBe(200);
    const thread = await fx.thread(fx.ana, linkId);
    expect(commentPageSchema.parse(thread.json())).toEqual({
      items: [],
      total: 0,
    });
  });

  it('Otro miembro no borra lo ajeno: 403 forbidden, and it stays', async () => {
    const linkId = await fx.newLink();
    const theirs = created(await fx.post(fx.beto, linkId, 'de Beto'));

    const response = await fx.remove(fx.carla, linkId, theirs.comment.id);

    expect(response.statusCode).toBe(403);
    expect(errorOf(response).code).toBe('forbidden');
    expect(await fx.storedComments(linkId)).toBe(1);
  });

  it('Borrar dos veces: 404 comment_not_found', async () => {
    const linkId = await fx.newLink();
    const mine = created(await fx.post(fx.beto, linkId, 'de Beto'));
    await fx.remove(fx.beto, linkId, mine.comment.id);

    const again = await fx.remove(fx.beto, linkId, mine.comment.id);

    expect(again.statusCode).toBe(404);
    expect(errorOf(again).code).toBe('comment_not_found');
  });

  it('Comentario de otro link: 404 comment_not_found, and it stays in its thread', async () => {
    const first = await fx.newLink();
    const second = await fx.newLink();
    const mine = created(await fx.post(fx.beto, first, 'en L1'));

    const response = await fx.remove(fx.beto, second, mine.comment.id);
    const malformed = await fx.remove(fx.beto, first, 'no-es-un-id');

    expect(response.statusCode).toBe(404);
    expect(errorOf(response).code).toBe('comment_not_found');
    expect(malformed.statusCode).toBe(404);
    expect(errorOf(malformed).code).toBe('comment_not_found');
    expect(await fx.storedComments(first)).toBe(1);
  });

  it('Sin edición: PATCH answers 404 to the author and the owner, and nothing changes', async () => {
    const linkId = await fx.newLink();
    const mine = created(await fx.post(fx.beto, linkId, 'Original'));

    for (const member of [fx.beto, fx.ana]) {
      const response = await fx.http.request(
        'PATCH',
        `/api/groups/${fx.group.id}/links/${linkId}/comments/${mine.comment.id}`,
        { authorization: member.authorization, body: { text: 'Cambiado' } },
      );
      expect(response.statusCode).toBe(404);
    }
    const thread = commentPageSchema.parse(
      (await fx.thread(fx.ana, linkId)).json(),
    );
    expect(thread.items[0]?.text).toBe('Original');
  });
});

describe('membership with the real groups endpoints (5.6)', () => {
  it('Sale del grupo: the comment stays with the name and authorLeft; he can neither read nor delete; he comes back and deletes', async () => {
    const leaver = await fx.http.authenticated('Dani');
    await fx.http.join(leaver, fx.group);
    const linkId = await fx.newLink();
    const theirs = created(await fx.post(leaver, linkId, 'de Dani'));

    const leave = await fx.http.request(
      'DELETE',
      `/api/groups/${fx.group.id}/members/me`,
      { authorization: leaver.authorization },
    );
    expect(leave.statusCode).toBe(204);

    const seenByAna = commentPageSchema.parse(
      (await fx.thread(fx.ana, linkId)).json(),
    );
    expect(seenByAna.items[0]).toMatchObject({
      author: { userId: leaver.userId, displayName: 'Dani' },
      authorLeft: true,
    });

    // Fuera del grupo no borra.
    const outside = await fx.remove(leaver, linkId, theirs.comment.id);
    expect(outside.statusCode).toBe(404);
    expect(errorOf(outside).code).toBe('group_not_found');
    expect(await fx.storedComments(linkId)).toBe(1);

    // Vuelve y borra.
    await fx.http.join(leaver, fx.group);
    const back = commentPageSchema.parse(
      (await fx.thread(leaver, linkId)).json(),
    );
    expect(back.items[0]?.authorLeft).toBe(false);
    const deleted = await fx.remove(leaver, linkId, theirs.comment.id);
    expect(deleted.statusCode).toBe(200);
  });

  it('Expulsado: the summary of the group listing keeps the comment with authorLeft', async () => {
    const expelled = await fx.http.authenticated('Eva');
    await fx.http.join(expelled, fx.group);
    const linkId = await fx.newLink();
    created(await fx.post(expelled, linkId, 'de Eva'));

    const kick = await fx.http.request(
      'DELETE',
      `/api/groups/${fx.group.id}/members/${expelled.userId}`,
      { authorization: fx.ana.authorization },
    );
    expect(kick.statusCode).toBe(204);
    const links = linkPageSchema.parse(
      (
        await fx.http.request('GET', `/api/groups/${fx.group.id}/links?limit=50`, {
          authorization: fx.ana.authorization,
        })
      ).json(),
    );

    expect(
      links.items.find((item) => item.id === linkId)?.comments?.latest[0],
    ).toMatchObject({
      author: { userId: expelled.userId, displayName: 'Eva' },
      authorLeft: true,
    });
  });
});
