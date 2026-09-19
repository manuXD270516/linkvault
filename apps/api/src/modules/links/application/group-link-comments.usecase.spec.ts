import { beforeEach, describe, expect, it } from 'vitest';
import {
  CommentDeletionForbidden,
  CommentNotFound,
  CommentsGroupNotFound,
  InvalidCommentText,
  InvalidCursor,
  LinkNotFound,
  TooManyLinkAttempts,
} from '../domain/errors';
import {
  ANA,
  BACKEND,
  BETO,
  CARLA,
  CommentsHarness,
  FRONTEND,
  STRANGER,
} from './testing/comments-test-harness';

// Casos de uso de comentarios (tareas 3.2, 3.3 y 3.4 de group-comments) con los dobles en memoria.

let harness: CommentsHarness;
let linkId: string;

beforeEach(async () => {
  harness = new CommentsHarness();
  linkId = await harness.shared(BACKEND, ANA);
});

describe('PostGroupLinkComment (3.2)', () => {
  it('Comentar una oferta del grupo', async () => {
    const response = await harness.post.execute(BETO, BACKEND, linkId, {
      text: 'Piden inglés C1',
    });

    expect(response.comment).toEqual({
      id: expect.any(String),
      author: { userId: BETO, displayName: 'Beto' },
      authorLeft: false,
      text: 'Piden inglés C1',
      createdAt: '2026-09-19T10:00:00.000Z',
    });
    expect(response.comments).toEqual({
      count: 1,
      revision: 1,
      sharedAt: '2026-09-19T10:00:00.000Z',
      latest: [response.comment],
    });
  });

  it('consumes before writing and publishes after, without text or author', async () => {
    const response = await harness.post.execute(BETO, BACKEND, linkId, {
      text: 'Piden inglés C1',
    });

    expect(harness.limiter.consumed).toEqual([
      { kind: 'comment', userId: BETO },
    ]);
    expect(harness.limiter.refunded).toEqual([]);
    expect(harness.publisher.published).toEqual([
      {
        groupId: BACKEND,
        linkId,
        commentId: response.comment.id,
        change: 'created',
      },
    ]);
  });

  it('Extraño no comenta: the same 404 for a stranger, an unknown group and a malformed id, without counting', async () => {
    const unknownGroup = '66e9a00000000000000000ff';
    for (const groupId of [BACKEND, unknownGroup, 'no-es-un-id']) {
      await expect(
        harness.post.execute(STRANGER, groupId, linkId, { text: 'Hola' }),
      ).rejects.toBeInstanceOf(CommentsGroupNotFound);
    }
    expect(harness.comments.size).toBe(0);
    expect(harness.limiter.consumed).toEqual([]);
  });

  it('Link que no está en el grupo: link_not_found, and the attempt is given back', async () => {
    const elsewhere = await harness.shared(
      FRONTEND,
      BETO,
      'https://www.linkedin.com/jobs/view/3822222222/',
    );

    for (const target of [elsewhere, harness.unshared(), 'no-es-un-id']) {
      await expect(
        harness.post.execute(ANA, BACKEND, target, { text: 'Hola' }),
      ).rejects.toBeInstanceOf(LinkNotFound);
    }
    expect(harness.comments.size).toBe(0);
    expect(harness.limiter.refunded).toHaveLength(3);
    expect(harness.publisher.published).toEqual([]);
  });

  it('Lo rechazado no gasta: an empty or too long text is refused before counting', async () => {
    for (const text of ['   ', 'a'.repeat(501)]) {
      await expect(
        harness.post.execute(BETO, BACKEND, linkId, { text }),
      ).rejects.toBeInstanceOf(InvalidCommentText);
    }
    expect(harness.limiter.consumed).toEqual([]);
  });

  it('Ventana agotada: too_many_attempts with the wait, and nothing stored', async () => {
    harness.limiter.exhaust({ kind: 'comment', userId: BETO });

    const refused = harness.post.execute(BETO, BACKEND, linkId, {
      text: 'Hola',
    });

    await expect(refused).rejects.toBeInstanceOf(TooManyLinkAttempts);
    await expect(refused).rejects.toMatchObject({ retryAfterSeconds: 900 });
    expect(harness.comments.size).toBe(0);
    expect(harness.publisher.published).toEqual([]);
  });

  it('Carrera que termina en 404 no gasta: the attempt comes back and the next comment fits', async () => {
    harness.limiter.withLimit({ kind: 'comment', userId: BETO }, 1);
    // El link se quita entre el límite y la escritura: el alta encuentra la relación ya borrada.
    const addComment = harness.groupLinks.addComment.bind(harness.groupLinks);
    harness.groupLinks.addComment = async (draft) => {
      await harness.groupLinks.removeWithComments(BACKEND, linkId);
      return await addComment(draft);
    };

    await expect(
      harness.post.execute(BETO, BACKEND, linkId, { text: 'Hola' }),
    ).rejects.toBeInstanceOf(LinkNotFound);

    harness.groupLinks.addComment = addComment;
    const other = await harness.shared(
      BACKEND,
      ANA,
      'https://www.linkedin.com/jobs/view/3822222222/',
    );
    await expect(
      harness.post.execute(BETO, BACKEND, other, { text: 'Otra' }),
    ).resolves.toMatchObject({ comments: { count: 1 } });
  });

  it('gives the attempt back when the write fails for any other reason', async () => {
    harness.groupLinks.addComment = () =>
      Promise.reject(new Error('Mongo is down'));

    await expect(
      harness.post.execute(BETO, BACKEND, linkId, { text: 'Hola' }),
    ).rejects.toThrow('Mongo is down');
    expect(harness.limiter.refunded).toEqual([
      { kind: 'comment', userId: BETO },
    ]);
  });

  it('Redis caído al comentar: the comment is stored and answered anyway', async () => {
    harness.publisher.fail();

    const response = await harness.post.execute(BETO, BACKEND, linkId, {
      text: 'Hola',
    });

    expect(response.comments.count).toBe(1);
    expect(harness.comments.size).toBe(1);
  });

  it('does not wait for the notice to go out', async () => {
    harness.publisher.hang();

    await expect(
      harness.post.execute(BETO, BACKEND, linkId, { text: 'Hola' }),
    ).resolves.toMatchObject({ comments: { count: 1 } });
  });

  it('answers the two newest in the summary, newest first', async () => {
    await harness.comment(ANA, BACKEND, linkId, 'uno');
    await harness.comment(BETO, BACKEND, linkId, 'dos');
    const third = await harness.comment(CARLA, BACKEND, linkId, 'tres');

    expect(third.comments.count).toBe(3);
    expect(third.comments.latest.map((comment) => comment.text)).toEqual([
      'tres',
      'dos',
    ]);
  });
});

describe('DeleteGroupLinkComment (3.3)', () => {
  it('Borrar el propio: 200 with the new summary, and a notice', async () => {
    await harness.comment(ANA, BACKEND, linkId, 'de Ana');
    const mine = await harness.comment(BETO, BACKEND, linkId, 'de Beto');

    const response = await harness.remove.execute(
      BETO,
      BACKEND,
      linkId,
      mine.comment.id,
    );

    expect(response.comments).toMatchObject({ count: 1, revision: 3 });
    expect(response.comments.latest.map((comment) => comment.text)).toEqual([
      'de Ana',
    ]);
    expect(harness.publisher.published.at(-1)).toEqual({
      groupId: BACKEND,
      linkId,
      commentId: mine.comment.id,
      change: 'deleted',
    });
  });

  it('El propietario borra un comentario ajeno, without a mark', async () => {
    const theirs = await harness.comment(BETO, BACKEND, linkId);

    const response = await harness.remove.execute(
      ANA,
      BACKEND,
      linkId,
      theirs.comment.id,
    );

    expect(response.comments).toMatchObject({ count: 0, latest: [] });
    expect(harness.comments.size).toBe(0);
  });

  it('Otro miembro no borra lo ajeno: forbidden, and the comment stays', async () => {
    const theirs = await harness.comment(BETO, BACKEND, linkId);

    await expect(
      harness.remove.execute(CARLA, BACKEND, linkId, theirs.comment.id),
    ).rejects.toBeInstanceOf(CommentDeletionForbidden);
    expect(harness.comments.size).toBe(1);
  });

  it('Borrar dos veces: comment_not_found the second time', async () => {
    const mine = await harness.comment(BETO, BACKEND, linkId);
    await harness.remove.execute(BETO, BACKEND, linkId, mine.comment.id);
    const notices = harness.publisher.published.length;

    await expect(
      harness.remove.execute(BETO, BACKEND, linkId, mine.comment.id),
    ).rejects.toBeInstanceOf(CommentNotFound);
    expect(harness.publisher.published).toHaveLength(notices);
  });

  it('Comentario de otro link: comment_not_found, and it stays in its thread', async () => {
    const other = await harness.shared(
      BACKEND,
      ANA,
      'https://www.linkedin.com/jobs/view/3822222222/',
    );
    const mine = await harness.comment(BETO, BACKEND, linkId);

    await expect(
      harness.remove.execute(BETO, BACKEND, other, mine.comment.id),
    ).rejects.toBeInstanceOf(CommentNotFound);
    await expect(
      harness.remove.execute(BETO, BACKEND, linkId, 'no-es-un-id'),
    ).rejects.toBeInstanceOf(CommentNotFound);
    expect(harness.comments.size).toBe(1);
  });

  it('answers group_not_found to someone who is not a member, before anything else', async () => {
    const mine = await harness.comment(BETO, BACKEND, linkId);

    await expect(
      harness.remove.execute(STRANGER, BACKEND, linkId, mine.comment.id),
    ).rejects.toBeInstanceOf(CommentsGroupNotFound);
  });

  it('answers comment_not_found without a notice when another delete got there first', async () => {
    const mine = await harness.comment(BETO, BACKEND, linkId);
    const notices = harness.publisher.published.length;
    harness.groupLinks.removeComment = () => Promise.resolve(null);

    await expect(
      harness.remove.execute(BETO, BACKEND, linkId, mine.comment.id),
    ).rejects.toBeInstanceOf(CommentNotFound);
    expect(harness.publisher.published).toHaveLength(notices);
  });

  it('does not count against the comment limit', async () => {
    const mine = await harness.comment(BETO, BACKEND, linkId);
    harness.limiter.exhaust({ kind: 'comment', userId: BETO });
    const consumed = harness.limiter.consumed.length;

    await harness.remove.execute(BETO, BACKEND, linkId, mine.comment.id);

    expect(harness.limiter.consumed).toHaveLength(consumed);
  });
});

describe('ListGroupLinkComments (3.4)', () => {
  it('pages the thread newest first with the total from the counter', async () => {
    for (let index = 0; index < 5; index += 1) {
      await harness.comment(BETO, BACKEND, linkId, `c${index}`);
    }

    const first = await harness.thread.execute(ANA, BACKEND, linkId, {
      limit: 2,
    });
    const second = await harness.thread.execute(ANA, BACKEND, linkId, {
      limit: 2,
      ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
    });

    expect(first.total).toBe(5);
    expect(first.items.map((comment) => comment.text)).toEqual(['c4', 'c3']);
    expect(second.items.map((comment) => comment.text)).toEqual(['c2', 'c1']);
  });

  it('Cada grupo tiene su hilo', async () => {
    await harness.shared(FRONTEND, BETO);
    await harness.comment(BETO, BACKEND, linkId, 'en A');

    const page = await harness.thread.execute(ANA, FRONTEND, linkId, {
      limit: 20,
    });

    expect(page).toEqual({ items: [], total: 0 });
  });

  it('Extraño no lee el hilo, even with the link in his private list', async () => {
    await harness.saveLink.execute(STRANGER, {
      url: 'https://www.linkedin.com/jobs/view/3811111111/',
    });

    await expect(
      harness.thread.execute(STRANGER, BACKEND, linkId, { limit: 20 }),
    ).rejects.toBeInstanceOf(CommentsGroupNotFound);
  });

  it('answers link_not_found for a link that is not in the group', async () => {
    await expect(
      harness.thread.execute(ANA, BACKEND, harness.unshared(), { limit: 20 }),
    ).rejects.toBeInstanceOf(LinkNotFound);
  });

  it('rejects a manipulated cursor naming the field', async () => {
    await expect(
      harness.thread.execute(ANA, BACKEND, linkId, {
        limit: 20,
        cursor: 'roto',
      }),
    ).rejects.toBeInstanceOf(InvalidCursor);
  });

  it('Sale del grupo: the comment stays with the name and authorLeft', async () => {
    await harness.comment(BETO, BACKEND, linkId);
    harness.membership.withoutMember(BACKEND, BETO);

    const page = await harness.thread.execute(ANA, BACKEND, linkId, {
      limit: 20,
    });

    expect(page.items[0]).toMatchObject({
      author: { userId: BETO, displayName: 'Beto' },
      authorLeft: true,
    });
  });

  it('makes four fixed reads, whatever the size of the page', async () => {
    for (let index = 0; index < 3; index += 1) {
      await harness.comment(BETO, BACKEND, linkId);
    }
    harness.directory.calls = 0;
    harness.comments.pageCalls = 0;
    harness.groupLinks.findCalls = 0;
    harness.membership.memberIdsOfCalls = 0;

    await harness.thread.execute(ANA, BACKEND, linkId, { limit: 20 });

    expect(harness.membership.memberIdsOfCalls).toBe(1);
    expect(harness.directory.calls).toBe(1);
    expect(harness.comments.pageCalls).toBe(1);
    expect(harness.groupLinks.findCalls).toBe(1);
  });
});
