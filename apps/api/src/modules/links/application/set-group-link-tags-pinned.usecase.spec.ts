import { beforeEach, describe, expect, it } from 'vitest';
import { CommentsGroupNotFound, LinkNotFound } from '../domain/errors';
import { GetPublicPreview } from './get-public-preview.usecase';
import { ListGroupLinks } from './list-group-links.usecase';
import { ListMyLinks } from './list-my-links.usecase';
import { SaveLink } from './save-link.usecase';
import { SetGroupLinkPinned } from './set-group-link-pinned.usecase';
import { SetGroupLinkTags } from './set-group-link-tags.usecase';
import { InMemoryGroupLinkRepository } from './testing/in-memory-group-link.repository';
import { InMemoryJobLinkRepository } from './testing/in-memory-job-link.repository';
import { InMemoryUserLinkRepository } from './testing/in-memory-user-link.repository';
import { objectId } from './testing/link-fixtures';
import {
  InMemoryGroupMembership,
  InMemoryLinkUserDirectory,
  InMemoryOutbox,
  MovableClock,
  TestPublicUrls,
} from './testing/links-test-doubles';

// Tags y pinned en group_links (tareas 3.1–3.3 de group-link-tags-pinned): replace atómico, ACL 404, listado con
// campos y filtros, lista privada sin ellos, sin outbox.

const ANA = objectId(1);
const BETO = objectId(2);
const STRANGER = objectId(4);
const BACKEND = objectId(10);
const UNKNOWN_GROUP = objectId(99);
const MALFORMED = 'no-es-un-id';
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const JOB_PAGE_2 = 'https://www.linkedin.com/jobs/view/3822222222/';

let clock: MovableClock;
let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let membership: InMemoryGroupMembership;
let outbox: InMemoryOutbox;
let saveLink: SaveLink;
let setTags: SetGroupLinkTags;
let setPinned: SetGroupLinkPinned;
let listGroupLinks: ListGroupLinks;
let listMyLinks: ListMyLinks;

const urls = new TestPublicUrls();

beforeEach(() => {
  clock = new MovableClock();
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  userLinks = new InMemoryUserLinkRepository(links);
  outbox = new InMemoryOutbox();
  const directory = new InMemoryLinkUserDirectory()
    .set(ANA, 'Ana')
    .set(BETO, 'Beto');
  membership = new InMemoryGroupMembership()
    .withGroup(BACKEND, 'Backend Bolivia', 'private')
    .withMember(BACKEND, ANA, 'owner')
    .withMember(BACKEND, BETO);
  saveLink = new SaveLink(
    links,
    groupLinks,
    userLinks,
    outbox,
    membership,
    directory,
    urls,
    clock,
  );
  setTags = new SetGroupLinkTags(groupLinks, membership);
  setPinned = new SetGroupLinkPinned(groupLinks, membership);
  listGroupLinks = new ListGroupLinks(
    groupLinks,
    groupLinks.comments,
    membership,
    directory,
    urls,
  );
  listMyLinks = new ListMyLinks(userLinks, directory, membership);
});

async function shared(sharedBy: string, url = JOB_PAGE): Promise<string> {
  const response = await saveLink.execute(sharedBy, {
    url,
    groupId: BACKEND,
  });
  return response.link.id;
}

describe('SetGroupLinkTags', () => {
  it('replaces tags and returns the slim normalized array', async () => {
    const linkId = await shared(ANA);
    const beforeEvents = outbox.size;

    const result = await setTags.execute(ANA, BACKEND, linkId, {
      tags: ['remote', 'backend'],
    });

    expect(result).toEqual({ tags: ['remote', 'backend'] });
    expect((await groupLinks.find(BACKEND, linkId))?.tags).toEqual([
      'remote',
      'backend',
    ]);
    expect(outbox.size).toBe(beforeEvents);
  });

  it('empty array clears all tags', async () => {
    const linkId = await shared(ANA);
    await setTags.execute(ANA, BACKEND, linkId, { tags: ['remote'] });

    expect(await setTags.execute(ANA, BACKEND, linkId, { tags: [] })).toEqual({
      tags: [],
    });
    expect((await groupLinks.find(BACKEND, linkId))?.tags).toEqual([]);
  });

  it('No miembro: 404 group_not_found and the document does not change', async () => {
    const linkId = await shared(ANA);
    await setTags.execute(ANA, BACKEND, linkId, { tags: ['remote'] });

    await expect(
      setTags.execute(STRANGER, BACKEND, linkId, { tags: ['other'] }),
    ).rejects.toBeInstanceOf(CommentsGroupNotFound);
    await expect(
      setTags.execute(ANA, UNKNOWN_GROUP, linkId, { tags: ['other'] }),
    ).rejects.toBeInstanceOf(CommentsGroupNotFound);
    await expect(
      setTags.execute(ANA, MALFORMED, linkId, { tags: ['other'] }),
    ).rejects.toBeInstanceOf(CommentsGroupNotFound);

    expect((await groupLinks.find(BACKEND, linkId))?.tags).toEqual(['remote']);
  });

  it('Relación inexistente: 404 link_not_found', async () => {
    await shared(ANA);
    const missing = objectId(50);

    await expect(
      setTags.execute(ANA, BACKEND, missing, { tags: ['remote'] }),
    ).rejects.toBeInstanceOf(LinkNotFound);
    await expect(
      setTags.execute(ANA, BACKEND, MALFORMED, { tags: ['remote'] }),
    ).rejects.toBeInstanceOf(LinkNotFound);
  });
});

describe('SetGroupLinkPinned', () => {
  it('pins and unpins without outbox', async () => {
    const linkId = await shared(ANA);
    const beforeEvents = outbox.size;

    expect(
      await setPinned.execute(ANA, BACKEND, linkId, { pinned: true }),
    ).toEqual({ pinned: true });
    expect((await groupLinks.find(BACKEND, linkId))?.pinned).toBe(true);

    expect(
      await setPinned.execute(BETO, BACKEND, linkId, { pinned: false }),
    ).toEqual({ pinned: false });
    expect(outbox.size).toBe(beforeEvents);
  });

  it('No miembro: 404 group_not_found', async () => {
    const linkId = await shared(ANA);

    await expect(
      setPinned.execute(STRANGER, BACKEND, linkId, { pinned: true }),
    ).rejects.toBeInstanceOf(CommentsGroupNotFound);
    expect((await groupLinks.find(BACKEND, linkId))?.pinned).toBe(false);
  });

  it('Relación inexistente: 404 link_not_found', async () => {
    await shared(ANA);

    await expect(
      setPinned.execute(ANA, BACKEND, objectId(50), { pinned: true }),
    ).rejects.toBeInstanceOf(LinkNotFound);
  });
});

describe('ListGroupLinks tags and pinned', () => {
  it('always includes tags and pinned with defaults', async () => {
    await shared(ANA);

    const page = await listGroupLinks.execute(ANA, BACKEND, { limit: 20 });
    expect(page.items[0]?.tags).toEqual([]);
    expect(page.items[0]?.pinned).toBe(false);
  });

  it('exposes set tags and pinned on the group list', async () => {
    const linkId = await shared(ANA);
    await setTags.execute(ANA, BACKEND, linkId, { tags: ['backend'] });
    await setPinned.execute(ANA, BACKEND, linkId, { pinned: true });

    const page = await listGroupLinks.execute(BETO, BACKEND, { limit: 20 });
    const item = page.items.find((link) => link.id === linkId);

    expect(item?.tags).toEqual(['backend']);
    expect(item?.pinned).toBe(true);
  });

  it('filters pinned=true and aligns total with the same match', async () => {
    const pinnedId = await shared(ANA, JOB_PAGE);
    await shared(ANA, JOB_PAGE_2);
    await setPinned.execute(ANA, BACKEND, pinnedId, { pinned: true });

    const page = await listGroupLinks.execute(ANA, BACKEND, {
      limit: 20,
      pinned: true,
    });

    expect(page.items.map((item) => item.id)).toEqual([pinnedId]);
    expect(page.total).toBe(1);
  });

  it('filters pinned=false without treating the string false as true', async () => {
    const pinnedId = await shared(ANA, JOB_PAGE);
    const otherId = await shared(ANA, JOB_PAGE_2);
    await setPinned.execute(ANA, BACKEND, pinnedId, { pinned: true });

    const page = await listGroupLinks.execute(ANA, BACKEND, {
      limit: 20,
      pinned: false,
    });

    expect(page.items.map((item) => item.id)).toEqual([otherId]);
    expect(page.total).toBe(1);
  });

  it('filters by tag after normalize and aligns total', async () => {
    const taggedId = await shared(ANA, JOB_PAGE);
    await shared(ANA, JOB_PAGE_2);
    await setTags.execute(ANA, BACKEND, taggedId, { tags: ['remote'] });

    const page = await listGroupLinks.execute(ANA, BACKEND, {
      limit: 20,
      tag: 'remote',
    });

    expect(page.items.map((item) => item.id)).toEqual([taggedId]);
    expect(page.total).toBe(1);
  });

  it('does not reorder by pin: newer unpinned comes before older pinned', async () => {
    const older = await shared(ANA, JOB_PAGE);
    await setPinned.execute(ANA, BACKEND, older, { pinned: true });
    clock.advance(60_000);
    const newer = await shared(ANA, JOB_PAGE_2);

    const page = await listGroupLinks.execute(ANA, BACKEND, { limit: 20 });

    expect(page.items.map((item) => item.id)).toEqual([newer, older]);
  });
});

describe('ListMyLinks omits tags and pinned', () => {
  it('private list never includes tags or pinned', async () => {
    const saved = await saveLink.execute(ANA, { url: JOB_PAGE });
    await saveLink.execute(ANA, { url: JOB_PAGE, groupId: BACKEND });
    const linkId = saved.link.id;
    await setTags.execute(ANA, BACKEND, linkId, { tags: ['remote'] });
    await setPinned.execute(ANA, BACKEND, linkId, { pinned: true });

    const page = await listMyLinks.execute(ANA, { limit: 20 });
    const item = page.items.find((link) => link.id === linkId);

    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('tags');
    expect(item).not.toHaveProperty('pinned');
  });
});

describe('no leak to public preview', () => {
  it('GetPublicPreview mapping does not include group tags or pinned', async () => {
    const preview = new GetPublicPreview(groupLinks, links);
    const linkId = await shared(ANA);
    await setTags.execute(ANA, BACKEND, linkId, { tags: ['secret-tag'] });
    await setPinned.execute(ANA, BACKEND, linkId, { pinned: true });
    const share = await groupLinks.publish(BACKEND, linkId, ANA, clock.now());

    const response = await preview.execute(share?.slug ?? '');
    const serialized = JSON.stringify(response);

    expect(response?.link).not.toHaveProperty('tags');
    expect(response?.link).not.toHaveProperty('pinned');
    expect(serialized).not.toContain('secret-tag');
    expect(serialized).not.toContain('"pinned"');
  });
});
