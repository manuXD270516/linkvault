import { beforeEach, describe, expect, it } from 'vitest';
import type { JobLink } from '../../domain/job-link';
import { InMemoryJobLinkRepository } from './in-memory-job-link.repository';
import { InMemoryUserLinkRepository } from './in-memory-user-link.repository';
import { jobLinkDraft, objectId } from './link-fixtures';
import { IN_MEMORY_SESSION } from './links-test-doubles';

const ANA = objectId(1);
const BETO = objectId(2);
const now = new Date('2026-09-17T10:00:00.000Z');
const later = new Date('2026-09-17T11:00:00.000Z');

let links: InMemoryJobLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let link: JobLink;
let other: JobLink;

beforeEach(() => {
  links = new InMemoryJobLinkRepository();
  userLinks = new InMemoryUserLinkRepository(links);
  link = links.seed(jobLinkDraft('https://www.linkedin.com/jobs/view/3811111111/'));
  other = links.seed(jobLinkDraft('https://www.linkedin.com/jobs/view/3822222222/'));
});

function save(userId: string, linkId: string, savedAt = now) {
  return userLinks.save({ userId, linkId, savedAt }, IN_MEMORY_SESSION);
}

describe('save', () => {
  it('saves a link in the private list', async () => {
    const { relation, created } = await save(ANA, link.id);

    expect(created).toBe(true);
    expect(relation).toEqual({ userId: ANA, linkId: link.id, savedAt: now });
  });

  it('is idempotent: saving twice keeps one entry with its first date', async () => {
    await save(ANA, link.id);
    const second = await save(ANA, link.id, later);

    expect(second.created).toBe(false);
    expect(second.relation.savedAt).toEqual(now);
    expect(await userLinks.countByUser(ANA)).toBe(1);
  });

  it('writes with the session it was given, the one of the transaction', async () => {
    await save(ANA, link.id);

    expect(userLinks.lastSession).toBe(IN_MEMORY_SESSION);
  });

  it('lets two people keep the same vacancy in their own lists', async () => {
    await save(ANA, link.id);
    await save(BETO, link.id);

    expect(await userLinks.countByUser(ANA)).toBe(1);
    expect(await userLinks.countByUser(BETO)).toBe(1);
    expect(links.size).toBe(2);
  });
});

describe('find, listByUser and countByUser', () => {
  it('lists only the links of that person, the most recent first, with no sharer', async () => {
    await save(ANA, link.id);
    await save(ANA, other.id, later);
    await save(BETO, other.id);

    const page = await userLinks.listByUser(ANA, { limit: 20 });

    expect(page.items.map((item) => item.link.id)).toEqual([other.id, link.id]);
    expect(page.items.map((item) => item.sharedBy)).toEqual([
      undefined,
      undefined,
    ]);
    expect(page.items[0]?.sharedAt).toEqual(later);
  });

  it('answers an empty list for someone with nothing saved or a malformed id', async () => {
    expect((await userLinks.listByUser(BETO, { limit: 20 })).items).toEqual([]);
    expect((await userLinks.listByUser('no-es-un-id', { limit: 20 })).items).toEqual(
      [],
    );
    expect(await userLinks.countByUser('no-es-un-id')).toBe(0);
  });

  it('finds an entry and answers null for one that is not there', async () => {
    await save(ANA, link.id);

    expect(await userLinks.find(ANA, link.id)).toEqual({
      userId: ANA,
      linkId: link.id,
      savedAt: now,
    });
    expect(await userLinks.find(BETO, link.id)).toBeNull();
    expect(await userLinks.find(ANA, 'no-es-un-id')).toBeNull();
  });

  it('walks the pages with the cursor when everything was saved at once', async () => {
    const saved = [];
    for (let index = 0; index < 5; index += 1) {
      const current = links.seed(
        jobLinkDraft(`https://empresa.example/careers/${index}`),
      );
      await save(ANA, current.id, now);
      saved.push(current.id);
    }

    const first = await userLinks.listByUser(ANA, { limit: 3 });
    const second = await userLinks.listByUser(ANA, {
      limit: 3,
      ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
    });
    const seen = [...first.items, ...second.items].map((item) => item.link.id);

    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(new Set(saved));
    expect(second.nextCursor).toBeUndefined();
  });
});

describe('remove and deleteByLink', () => {
  it('removes the entry and never the vacancy', async () => {
    await save(ANA, link.id);

    expect(await userLinks.remove(ANA, link.id)).toBe(true);
    expect(await userLinks.find(ANA, link.id)).toBeNull();
    expect(await links.findById(link.id)).not.toBeNull();
  });

  it('answers false when the link was not in the list', async () => {
    expect(await userLinks.remove(ANA, link.id)).toBe(false);
  });

  it('deletes the private entries of a link, of everybody', async () => {
    await save(ANA, link.id);
    await save(BETO, link.id);

    expect(await userLinks.deleteByLink(link.id)).toBe(2);
    expect(userLinks.size).toBe(0);
  });
});
