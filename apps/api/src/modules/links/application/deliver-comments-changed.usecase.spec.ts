import type { GroupLinkCommentsChangedPayload } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { DeliverCommentsChanged } from './deliver-comments-changed.usecase';
import {
  ANA,
  BACKEND,
  BETO,
  CARLA,
  CommentsHarness,
  FRONTEND,
  STRANGER,
} from './testing/comments-test-harness';
import { InMemoryCommentsBroadcaster } from './testing/links-test-doubles';

// Reparto de los avisos de comentarios (tarea 4.3 de group-comments) con los dobles en memoria.

let harness: CommentsHarness;
let broadcaster: InMemoryCommentsBroadcaster;
let deliver: DeliverCommentsChanged;
let linkId: string;

beforeEach(async () => {
  harness = new CommentsHarness();
  broadcaster = new InMemoryCommentsBroadcaster();
  deliver = new DeliverCommentsChanged(
    harness.groupLinks,
    harness.comments,
    harness.membership,
    harness.directory,
    broadcaster,
  );
  linkId = await harness.shared(BACKEND, ANA);
});

function lastNotice(): GroupLinkCommentsChangedPayload {
  const notice = harness.publisher.published.at(-1);
  if (notice === undefined) {
    throw new Error('Nothing was published');
  }
  return notice;
}

describe('DeliverCommentsChanged', () => {
  it('Los miembros se enteran: created, the comment id and the updated summary', async () => {
    const posted = await harness.comment(BETO, BACKEND, linkId, 'Piden C1');

    const delivered = await deliver.execute(lastNotice());

    expect(delivered).toBe(3);
    expect(broadcaster.recipients.sort()).toEqual([ANA, BETO, CARLA].sort());
    expect(broadcaster.sent[0]?.message).toEqual({
      groupId: BACKEND,
      linkId,
      change: 'created',
      commentId: posted.comment.id,
      comments: {
        count: 1,
        revision: 1,
        sharedAt: '2026-09-19T10:00:00.000Z',
        latest: [posted.comment],
      },
    });
  });

  it('Quien ve el link por otro sitio no recibe nada', async () => {
    // El extraño lo tiene en su lista privada; Beto y Ana, además, en otro grupo.
    await harness.saveLink.execute(STRANGER, {
      url: 'https://www.linkedin.com/jobs/view/3811111111/',
    });
    await harness.shared(FRONTEND, BETO);
    await harness.comment(BETO, BACKEND, linkId);

    await deliver.execute(lastNotice());

    expect(broadcaster.recipients).not.toContain(STRANGER);
  });

  it('Quien salió deja de recibir', async () => {
    harness.membership.withoutMember(BACKEND, BETO);
    await harness.comment(ANA, BACKEND, linkId);

    await deliver.execute(lastNotice());

    expect(broadcaster.recipients).not.toContain(BETO);
    expect(broadcaster.recipients.sort()).toEqual([ANA, CARLA].sort());
  });

  it('Borrar también avisa: deleted with count 2', async () => {
    await harness.comment(ANA, BACKEND, linkId);
    await harness.comment(BETO, BACKEND, linkId);
    const third = await harness.comment(CARLA, BACKEND, linkId);
    await harness.remove.execute(ANA, BACKEND, linkId, third.comment.id);

    await deliver.execute(lastNotice());

    expect(broadcaster.sent[0]?.message).toMatchObject({
      change: 'deleted',
      commentId: third.comment.id,
      comments: { count: 2, revision: 4 },
    });
  });

  it('Link quitado antes de repartir: nobody receives anything', async () => {
    await harness.comment(BETO, BACKEND, linkId);
    await harness.removeGroupLink.execute(ANA, BACKEND, linkId);

    expect(await deliver.execute(lastNotice())).toBe(0);
    expect(broadcaster.sent).toEqual([]);
  });

  it('Nadie escuchando: discarded without reading anything', async () => {
    await harness.comment(BETO, BACKEND, linkId);
    broadcaster.withoutListeners();
    harness.membership.memberIdsOfCalls = 0;
    harness.groupLinks.findCalls = 0;
    harness.comments.latestByLinksCalls = 0;

    expect(await deliver.execute(lastNotice())).toBe(0);
    expect(harness.membership.memberIdsOfCalls).toBe(0);
    expect(harness.groupLinks.findCalls).toBe(0);
    expect(harness.comments.latestByLinksCalls).toBe(0);
  });

  it('marks an author who left, in the summary it sends', async () => {
    await harness.comment(BETO, BACKEND, linkId);
    harness.membership.withoutMember(BACKEND, BETO);
    await harness.comment(ANA, BACKEND, linkId);

    await deliver.execute(lastNotice());

    expect(
      broadcaster.sent[0]?.message.comments.latest.map(
        (comment) => comment.authorLeft,
      ),
    ).toEqual([false, true]);
  });
});
