import {
  apiErrorResponseSchema,
  deleteCommentResponseSchema,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCommentsTestApp,
  type CommentsTestApp,
} from '../../../test-support/comments-test-app';

// Concurrencia por HTTP (tareas 5.8 y 5.9 de group-comments). La carrera de verdad la prueban de forma determinista los
// tests del repositorio (2.10 y 2.11); esto es el humo de extremo a extremo: nunca queda un comentario sin relación, y
// dos borrados a la vez del mismo comentario lo borran una sola vez.

let fx: CommentsTestApp;

beforeAll(async () => {
  fx = await createCommentsTestApp('comments-race', getMongoTestUri());
});

afterAll(async () => {
  await fx.close();
});

describe('Comentar mientras se quita (5.8, smoke)', () => {
  it('20 rounds of commenting and removing at once leave no orphan comment', async () => {
    const url = 'https://empresa.example/careers/carrera-http';
    const statuses = new Set<string>();

    for (let round = 0; round < 20; round += 1) {
      const saved = await fx.save(fx.ana, url, { groupId: fx.group.id });
      const linkId = saved.link.id;

      const [comment, removal] = await Promise.all([
        fx.post(fx.beto, linkId, `Ronda ${round}`),
        fx.http.request('DELETE', `/api/groups/${fx.group.id}/links/${linkId}`, {
          authorization: fx.ana.authorization,
        }),
      ]);

      expect(removal.statusCode).toBe(204);
      if (comment.statusCode === 201) {
        statuses.add('201');
      } else {
        expect(comment.statusCode).toBe(404);
        expect(apiErrorResponseSchema.parse(comment.json()).code).toBe(
          'link_not_found',
        );
        statuses.add('404');
      }
      // Ni la relación ni ningún comentario suyo: tampoco uno que se colara tras la retirada.
      expect(await fx.counters(linkId)).toBeNull();
      expect(await fx.storedComments(linkId)).toBe(0);
    }
    expect([...statuses].every((status) => ['201', '404'].includes(status))).toBe(
      true,
    );
  });
});

describe('Dos borrados a la vez (5.9)', () => {
  it('the author and the owner delete the same comment at once: one 200 and one 404, count -1 and revision +1', async () => {
    const linkId = await fx.newLink();
    for (const [member, text] of [
      [fx.ana, 'uno'],
      [fx.carla, 'dos'],
    ] as const) {
      expect((await fx.post(member, linkId, text)).statusCode).toBe(201);
    }
    const betos = await fx.post(fx.beto, linkId, 'de Beto');
    const commentId = betos.json<{ comment: { id: string } }>().comment.id;
    const before = await fx.counters(linkId);
    expect(before).toEqual({ commentCount: 3, commentsRevision: 3 });

    const responses = await Promise.all([
      fx.remove(fx.beto, linkId, commentId),
      fx.remove(fx.ana, linkId, commentId),
    ]);

    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([200, 404]);
    const notFound = responses.find((response) => response.statusCode === 404);
    expect(apiErrorResponseSchema.parse(notFound?.json()).code).toBe(
      'comment_not_found',
    );
    const ok = responses.find((response) => response.statusCode === 200);
    expect(deleteCommentResponseSchema.parse(ok?.json()).comments).toMatchObject({
      count: 2,
      revision: 4,
    });
    expect(await fx.counters(linkId)).toEqual({
      commentCount: 2,
      commentsRevision: 4,
    });
    expect(await fx.storedComments(linkId)).toBe(2);
  });
});
