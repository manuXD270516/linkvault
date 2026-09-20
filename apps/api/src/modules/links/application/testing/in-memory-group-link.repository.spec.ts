import { beforeEach, describe, expect, it } from 'vitest';
import type { JobLink } from '../../domain/job-link';
import { InMemoryGroupLinkRepository } from './in-memory-group-link.repository';
import { InMemoryJobLinkRepository } from './in-memory-job-link.repository';
import { jobLinkDraft, objectId } from './link-fixtures';
import { IN_MEMORY_SESSION } from './links-test-doubles';
import { isValidPublicSlug } from '../../domain/public-slug';
import { StubPublicSlugGenerator } from './stub-public-slug.generator';

const ANA = objectId(1);
const BETO = objectId(2);
const BACKEND = objectId(10);
const FRONTEND = objectId(11);
const STRANGERS = objectId(12);
const now = new Date('2026-09-17T10:00:00.000Z');
const later = new Date('2026-09-17T11:00:00.000Z');

let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let link: JobLink;
let other: JobLink;

beforeEach(() => {
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  link = links.seed(jobLinkDraft('https://www.linkedin.com/jobs/view/3811111111/'));
  other = links.seed(jobLinkDraft('https://www.linkedin.com/jobs/view/3822222222/'));
});

function share(
  groupId: string,
  linkId: string,
  sharedBy: string,
  sharedAt = now,
) {
  return groupLinks.share(
    { groupId, linkId, sharedBy, sharedAt },
    IN_MEMORY_SESSION,
  );
}

function comment(groupId: string, linkId: string, authorId: string) {
  return groupLinks.addComment({
    groupId,
    linkId,
    authorId,
    text: 'Piden inglés C1',
    createdAt: later,
  });
}

describe('share', () => {
  it('shares a link in a group', async () => {
    const { relation, created } = await share(BACKEND, link.id, ANA);

    expect(created).toBe(true);
    expect(relation).toEqual({
      groupId: BACKEND,
      linkId: link.id,
      sharedBy: ANA,
      sharedAt: now,
      commentCount: 0,
      commentsRevision: 0,
    });
  });

  it('keeps one relation per group and link, with its first sharer', async () => {
    await share(BACKEND, link.id, ANA);
    const second = await share(BACKEND, link.id, BETO, later);

    expect(second.created).toBe(false);
    expect(second.relation.sharedBy).toBe(ANA);
    expect(second.relation.sharedAt).toEqual(now);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(1);
  });

  it('writes with the session it was given, the one of the transaction', async () => {
    await share(BACKEND, link.id, ANA);

    expect(groupLinks.lastSession).toBe(IN_MEMORY_SESSION);
  });

  it('lets the same link live in two groups', async () => {
    await share(BACKEND, link.id, ANA);
    await share(FRONTEND, link.id, ANA);

    expect(await groupLinks.countByGroup(BACKEND)).toBe(1);
    expect(await groupLinks.countByGroup(FRONTEND)).toBe(1);
    expect(links.size).toBe(2);
  });
});

describe('find and listByGroup', () => {
  it('finds the relation of a link that is in the group', async () => {
    await share(BACKEND, link.id, ANA);

    expect(await groupLinks.find(BACKEND, link.id)).toEqual({
      groupId: BACKEND,
      linkId: link.id,
      sharedBy: ANA,
      sharedAt: now,
      commentCount: 0,
      commentsRevision: 0,
    });
  });

  it('answers null for a link of another group or a malformed id', async () => {
    await share(BACKEND, link.id, ANA);

    expect(await groupLinks.find(FRONTEND, link.id)).toBeNull();
    expect(await groupLinks.find(BACKEND, other.id)).toBeNull();
    expect(await groupLinks.find('no-es-un-id', link.id)).toBeNull();
  });

  it('lists the links of the group, the most recent first, with their sharer', async () => {
    await share(BACKEND, link.id, ANA);
    await share(BACKEND, other.id, BETO, later);

    const page = await groupLinks.listByGroup(BACKEND, { limit: 20 });

    expect(page.items.map((item) => item.link.id)).toEqual([other.id, link.id]);
    expect(page.items.map((item) => item.sharedBy)).toEqual([BETO, ANA]);
    expect(page.nextCursor).toBeUndefined();
  });

  it('does not list the links of another group', async () => {
    await share(FRONTEND, link.id, ANA);

    expect((await groupLinks.listByGroup(STRANGERS, { limit: 20 })).items).toEqual(
      [],
    );
    expect(await groupLinks.countByGroup(STRANGERS)).toBe(0);
  });

  it('walks the pages with the cursor, without gaps or repeats', async () => {
    const saved = [];
    for (let index = 0; index < 5; index += 1) {
      const current = links.seed(
        jobLinkDraft(`https://empresa.example/careers/${index}`),
      );
      // Todos en el mismo instante: el desempate por id de la relación es lo único que ordena.
      await share(BACKEND, current.id, ANA, now);
      saved.push(current.id);
    }

    const first = await groupLinks.listByGroup(BACKEND, { limit: 2 });
    const second = await groupLinks.listByGroup(BACKEND, {
      limit: 2,
      ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
    });
    const third = await groupLinks.listByGroup(BACKEND, {
      limit: 2,
      ...(second.nextCursor === undefined ? {} : { cursor: second.nextCursor }),
    });
    const seen = [...first.items, ...second.items, ...third.items].map(
      (item) => item.link.id,
    );

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(new Set(seen)).toEqual(new Set(saved));
    expect(third.nextCursor).toBeUndefined();
  });
});

describe('groupsWithLink', () => {
  it('answers only the groups that were asked for and already have the link', async () => {
    await share(BACKEND, link.id, ANA);
    await share(STRANGERS, link.id, BETO);

    expect(await groupLinks.groupsWithLink([BACKEND, FRONTEND], link.id)).toEqual(
      new Set([BACKEND]),
    );
  });

  it('answers an empty set for a link nobody shared or a malformed id', async () => {
    expect(await groupLinks.groupsWithLink([BACKEND], other.id)).toEqual(
      new Set(),
    );
    expect(await groupLinks.groupsWithLink([BACKEND], 'no-es-un-id')).toEqual(
      new Set(),
    );
  });
});

describe('removeWithComments and deleteByGroup', () => {
  it('removes the relation and never the vacancy', async () => {
    await share(BACKEND, link.id, ANA);
    await share(FRONTEND, link.id, ANA);

    expect(await groupLinks.removeWithComments(BACKEND, link.id)).toBe(true);
    expect(await groupLinks.find(BACKEND, link.id)).toBeNull();
    expect(await groupLinks.find(FRONTEND, link.id)).not.toBeNull();
    expect(await links.findById(link.id)).not.toBeNull();
  });

  it('answers false when the link was not in the list', async () => {
    expect(await groupLinks.removeWithComments(BACKEND, link.id)).toBe(false);
    expect(await groupLinks.removeWithComments('no-es-un-id', link.id)).toBe(
      false,
    );
  });

  it('deletes every relation of a group, and only of that group', async () => {
    await share(BACKEND, link.id, ANA);
    await share(BACKEND, other.id, BETO);
    await share(FRONTEND, link.id, ANA);

    expect(await groupLinks.deleteByGroup(BACKEND, IN_MEMORY_SESSION)).toBe(2);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(0);
    expect(await groupLinks.countByGroup(FRONTEND)).toBe(1);
    expect(links.size).toBe(2);
  });

  it('takes the comments of that relation along, and only of that relation', async () => {
    await share(BACKEND, link.id, ANA);
    await share(FRONTEND, link.id, ANA);
    await comment(BACKEND, link.id, BETO);
    await comment(FRONTEND, link.id, BETO);

    await groupLinks.removeWithComments(BACKEND, link.id);

    expect(groupLinks.comments.of(BACKEND, link.id)).toHaveLength(0);
    expect(groupLinks.comments.of(FRONTEND, link.id)).toHaveLength(1);
  });

  it('deletes the comments of the group first, with the session it gets', async () => {
    await share(BACKEND, link.id, ANA);
    await share(FRONTEND, link.id, ANA);
    await comment(BACKEND, link.id, BETO);
    await comment(FRONTEND, link.id, BETO);

    await groupLinks.deleteByGroup(BACKEND, IN_MEMORY_SESSION);

    expect(groupLinks.comments.lastSession).toBe(IN_MEMORY_SESSION);
    expect(groupLinks.comments.of(BACKEND, link.id)).toHaveLength(0);
    expect(groupLinks.comments.of(FRONTEND, link.id)).toHaveLength(1);
  });
});

describe('the note', () => {
  const note = { text: 'Esta es la que te dije', createdAt: now };

  it('is written only when the relation is created', async () => {
    await groupLinks.share(
      { groupId: BACKEND, linkId: link.id, sharedBy: ANA, sharedAt: now, note },
      IN_MEMORY_SESSION,
    );
    const again = await groupLinks.share(
      {
        groupId: BACKEND,
        linkId: link.id,
        sharedBy: BETO,
        sharedAt: later,
        note: { text: 'Yo también la vi', createdAt: later },
      },
      IN_MEMORY_SESSION,
    );

    expect(again.relation.note).toEqual(note);
    expect((await groupLinks.find(BACKEND, link.id))?.note).toEqual(note);
  });

  it('is cleared, whether there was one or not, and false without the relation', async () => {
    await groupLinks.share(
      { groupId: BACKEND, linkId: link.id, sharedBy: ANA, sharedAt: now, note },
      IN_MEMORY_SESSION,
    );

    expect(await groupLinks.clearNote(BACKEND, link.id)).toBe(true);
    expect(await groupLinks.clearNote(BACKEND, link.id)).toBe(true);
    expect((await groupLinks.find(BACKEND, link.id))?.note).toBeUndefined();
    expect(await groupLinks.clearNote(FRONTEND, link.id)).toBe(false);
  });
});

describe('the comment counters', () => {
  it('start at 0 on a new relation', async () => {
    await share(BACKEND, link.id, ANA);

    expect(await groupLinks.find(BACKEND, link.id)).toMatchObject({
      commentCount: 0,
      commentsRevision: 0,
    });
  });

  it('go up with every comment and report the sharedAt of the relation', async () => {
    await share(BACKEND, link.id, ANA);

    const first = await comment(BACKEND, link.id, BETO);
    const second = await comment(BACKEND, link.id, ANA);

    expect(first?.counters).toEqual({ count: 1, revision: 1, sharedAt: now });
    expect(second?.counters).toEqual({ count: 2, revision: 2, sharedAt: now });
    expect(second?.comment.text).toBe('Piden inglés C1');
  });

  it('answer null and store nothing when the relation does not exist', async () => {
    expect(await comment(BACKEND, link.id, BETO)).toBeNull();
    expect(groupLinks.comments.size).toBe(0);
  });

  it('count down and revise up on a delete, and answer null without the comment', async () => {
    await share(BACKEND, link.id, ANA);
    const added = await comment(BACKEND, link.id, BETO);
    const commentId = added?.comment.id ?? '';

    expect(await groupLinks.removeComment(BACKEND, link.id, commentId)).toEqual({
      count: 0,
      revision: 2,
      sharedAt: now,
    });
    expect(await groupLinks.removeComment(BACKEND, link.id, commentId)).toBeNull();
    expect(await groupLinks.find(BACKEND, link.id)).toMatchObject({
      commentCount: 0,
      commentsRevision: 2,
    });
  });

  it('start again from 0 when the link is shared again', async () => {
    await share(BACKEND, link.id, ANA);
    await comment(BACKEND, link.id, BETO);
    await groupLinks.removeWithComments(BACKEND, link.id);
    await share(BACKEND, link.id, ANA, later);

    expect(await groupLinks.find(BACKEND, link.id)).toMatchObject({
      commentCount: 0,
      commentsRevision: 0,
      sharedAt: later,
    });
  });

  it('come with the note in the group listing', async () => {
    await groupLinks.share(
      {
        groupId: BACKEND,
        linkId: link.id,
        sharedBy: ANA,
        sharedAt: now,
        note: { text: 'Mira', createdAt: now },
      },
      IN_MEMORY_SESSION,
    );
    await comment(BACKEND, link.id, BETO);

    const page = await groupLinks.listByGroup(BACKEND, { limit: 20 });

    expect(page.items[0]?.inGroup).toEqual({
      note: { text: 'Mira', createdAt: now },
      commentCount: 1,
      commentsRevision: 1,
    });
  });
});

describe('linkIdsIn', () => {
  it('answers which of the links are shared in the group', async () => {
    await share(BACKEND, link.id, ANA);
    await share(FRONTEND, other.id, ANA);

    expect(
      await groupLinks.linkIdsIn(BACKEND, [link.id, other.id, 'no-es-un-id']),
    ).toEqual(new Set([link.id]));
    expect(await groupLinks.linkIdsIn(STRANGERS, [link.id])).toEqual(new Set());
    expect(await groupLinks.linkIdsIn('no-es-un-id', [link.id])).toEqual(
      new Set(),
    );
  });
});

// El doble se comporta igual que `MongoGroupLinkRepository` con el enlace público (tarea 3.5 de public-preview-share):
// el slug lo sortea el repositorio, publicar es idempotente y despublicar lo quema.
describe('el enlace público', () => {
  it('publica con un slug del formato del dominio', async () => {
    await share(BACKEND, link.id, ANA);

    const published = await groupLinks.publish(BACKEND, link.id, ANA, later);

    expect(isValidPublicSlug(published?.slug ?? '')).toBe(true);
    expect(published?.publishedBy).toBe(ANA);
    expect(published?.publishedAt).toEqual(later);
  });

  it('publicar dos veces devuelve el mismo enlace', async () => {
    await share(BACKEND, link.id, ANA);
    const first = await groupLinks.publish(BACKEND, link.id, ANA, later);

    expect(await groupLinks.publish(BACKEND, link.id, BETO, now)).toEqual(
      first,
    );
  });

  it('despublicar quema el slug y volver a publicar da otro', async () => {
    await share(BACKEND, link.id, ANA);
    const first = await groupLinks.publish(BACKEND, link.id, ANA, later);

    expect(await groupLinks.unpublish(BACKEND, link.id)).toBe(true);
    expect(await groupLinks.findByPublicSlug(first?.slug ?? '')).toBeNull();
    const again = await groupLinks.publish(BACKEND, link.id, ANA, later);
    expect(again?.slug).not.toBe(first?.slug);
  });

  it('responde null sobre una relación que no existe', async () => {
    expect(await groupLinks.publish(BACKEND, link.id, ANA, later)).toBeNull();
    expect(await groupLinks.unpublish(BACKEND, link.id)).toBe(false);
  });

  it('encuentra la relación por su slug, con la caja exacta', async () => {
    const repository = new InMemoryGroupLinkRepository(
      links,
      undefined,
      // Un slug con letras: uno de solo dígitos no distinguiría una comparación sensible a mayúsculas de una que no.
      new StubPublicSlugGenerator(['k7m2p9r4t6vw']),
    );
    await repository.share(
      { groupId: BACKEND, linkId: link.id, sharedBy: ANA, sharedAt: now },
      IN_MEMORY_SESSION,
    );
    await repository.publish(BACKEND, link.id, ANA, later);

    expect((await repository.findByPublicSlug('k7m2p9r4t6vw'))?.linkId).toBe(
      link.id,
    );
    expect(await repository.findByPublicSlug('K7M2P9R4T6VW')).toBeNull();
  });

  it('sortea otro slug cuando el generador repite uno ya usado', async () => {
    const slugs = new StubPublicSlugGenerator(['aaaaaaaaaaaa', 'aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
    const repository = new InMemoryGroupLinkRepository(
      links,
      undefined,
      slugs,
    );
    await repository.share(
      { groupId: BACKEND, linkId: link.id, sharedBy: ANA, sharedAt: now },
      IN_MEMORY_SESSION,
    );
    await repository.share(
      { groupId: FRONTEND, linkId: other.id, sharedBy: ANA, sharedAt: now },
      IN_MEMORY_SESSION,
    );

    const first = await repository.publish(BACKEND, link.id, ANA, later);
    const second = await repository.publish(FRONTEND, other.id, ANA, later);

    expect(first?.slug).toBe('aaaaaaaaaaaa');
    expect(second?.slug).toBe('bbbbbbbbbbbb');
  });

  it('nace publicado cuando el grupo comparte en público, solo si la relación es nueva', async () => {
    const first = await groupLinks.share(
      {
        groupId: BACKEND,
        linkId: link.id,
        sharedBy: ANA,
        sharedAt: now,
        publish: true,
      },
      IN_MEMORY_SESSION,
    );
    await groupLinks.unpublish(BACKEND, link.id);

    const second = await groupLinks.share(
      {
        groupId: BACKEND,
        linkId: link.id,
        sharedBy: BETO,
        sharedAt: later,
        publish: true,
      },
      IN_MEMORY_SESSION,
    );

    expect(isValidPublicSlug(first.relation.publicShare?.slug ?? '')).toBe(
      true,
    );
    expect(second.created).toBe(false);
    expect(second.relation.publicShare).toBeUndefined();
  });

  it('viaja en el listado del grupo sin una lectura más', async () => {
    await share(BACKEND, link.id, ANA);
    await share(BACKEND, other.id, ANA, later);
    const published = await groupLinks.publish(BACKEND, link.id, ANA, later);
    const before = groupLinks.listByGroupCalls;

    const page = await groupLinks.listByGroup(BACKEND, { limit: 20 });

    expect(groupLinks.listByGroupCalls).toBe(before + 1);
    expect(
      page.items.find((item) => item.link.id === link.id)?.inGroup
        ?.publicShare,
    ).toEqual(published);
    expect(
      page.items.find((item) => item.link.id === other.id)?.inGroup
        ?.publicShare,
    ).toBeUndefined();
  });

  it('se lo lleva la relación al quitar el link y al borrar el grupo', async () => {
    await share(BACKEND, link.id, ANA);
    await share(FRONTEND, other.id, ANA);
    const one = await groupLinks.publish(BACKEND, link.id, ANA, later);
    const two = await groupLinks.publish(FRONTEND, other.id, ANA, later);

    await groupLinks.removeWithComments(BACKEND, link.id);
    await groupLinks.deleteByGroup(FRONTEND, IN_MEMORY_SESSION);

    expect(await groupLinks.findByPublicSlug(one?.slug ?? '')).toBeNull();
    expect(await groupLinks.findByPublicSlug(two?.slug ?? '')).toBeNull();
  });
});
