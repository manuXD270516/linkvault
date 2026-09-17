import { beforeEach, describe, expect, it } from 'vitest';
import type { JobLink } from '../../domain/job-link';
import { InMemoryGroupLinkRepository } from './in-memory-group-link.repository';
import { InMemoryJobLinkRepository } from './in-memory-job-link.repository';
import { jobLinkDraft, objectId } from './link-fixtures';
import { IN_MEMORY_SESSION } from './links-test-doubles';

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

describe('share', () => {
  it('shares a link in a group', async () => {
    const { relation, created } = await share(BACKEND, link.id, ANA);

    expect(created).toBe(true);
    expect(relation).toEqual({
      groupId: BACKEND,
      linkId: link.id,
      sharedBy: ANA,
      sharedAt: now,
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

describe('remove, deleteByGroup and deleteByLink', () => {
  it('removes the relation and never the vacancy', async () => {
    await share(BACKEND, link.id, ANA);
    await share(FRONTEND, link.id, ANA);

    expect(await groupLinks.remove(BACKEND, link.id)).toBe(true);
    expect(await groupLinks.find(BACKEND, link.id)).toBeNull();
    expect(await groupLinks.find(FRONTEND, link.id)).not.toBeNull();
    expect(await links.findById(link.id)).not.toBeNull();
  });

  it('answers false when the link was not in the list', async () => {
    expect(await groupLinks.remove(BACKEND, link.id)).toBe(false);
    expect(await groupLinks.remove('no-es-un-id', link.id)).toBe(false);
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

  it('deletes every relation of a link', async () => {
    await share(BACKEND, link.id, ANA);
    await share(FRONTEND, link.id, ANA);

    expect(await groupLinks.deleteByLink(link.id)).toBe(2);
    expect(groupLinks.size).toBe(0);
  });
});
