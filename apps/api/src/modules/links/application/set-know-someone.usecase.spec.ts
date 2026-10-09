import { beforeEach, describe, expect, it } from 'vitest';
import { CommentsGroupNotFound, LinkNotFound } from '../domain/errors';
import { ListGroupLinks } from './list-group-links.usecase';
import { ListMyLinks } from './list-my-links.usecase';
import { SaveLink } from './save-link.usecase';
import { SetKnowSomeone } from './set-know-someone.usecase';
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

// Flag know-someone (tareas 2.2 de know-someone-flag): toggle atómico, listado de grupo siempre con estado, lista
// privada sin él, ACL 404s. Concurrencia básica: dos miembros marcan a la vez y el conteo llega a 2.

const ANA = objectId(1);
const BETO = objectId(2);
const CARLA = objectId(3);
const STRANGER = objectId(4);
const BACKEND = objectId(10);
const UNKNOWN_GROUP = objectId(99);
const MALFORMED = 'no-es-un-id';
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';

let clock: MovableClock;
let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let membership: InMemoryGroupMembership;
let saveLink: SaveLink;
let setKnowSomeone: SetKnowSomeone;
let listGroupLinks: ListGroupLinks;
let listMyLinks: ListMyLinks;

const urls = new TestPublicUrls();

beforeEach(() => {
  clock = new MovableClock();
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  userLinks = new InMemoryUserLinkRepository(links);
  const directory = new InMemoryLinkUserDirectory()
    .set(ANA, 'Ana')
    .set(BETO, 'Beto')
    .set(CARLA, 'Carla');
  membership = new InMemoryGroupMembership()
    .withGroup(BACKEND, 'Backend Bolivia', 'private')
    .withMember(BACKEND, ANA, 'owner')
    .withMember(BACKEND, BETO)
    .withMember(BACKEND, CARLA);
  saveLink = new SaveLink(
    links,
    groupLinks,
    userLinks,
    new InMemoryOutbox(),
    membership,
    directory,
    urls,
    clock,
  );
  setKnowSomeone = new SetKnowSomeone(groupLinks, membership);
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

describe('SetKnowSomeone', () => {
  it('Marcar: flaggedByMe true and count at least 1', async () => {
    const linkId = await shared(ANA);

    const state = await setKnowSomeone.execute(ANA, BACKEND, linkId, {
      flagged: true,
    });

    expect(state).toEqual({ flaggedByMe: true, count: 1 });
  });

  it('Desmarcar: removes the userId and flaggedByMe false', async () => {
    const linkId = await shared(ANA);
    await setKnowSomeone.execute(ANA, BACKEND, linkId, { flagged: true });

    const state = await setKnowSomeone.execute(ANA, BACKEND, linkId, {
      flagged: false,
    });

    expect(state).toEqual({ flaggedByMe: false, count: 0 });
    const relation = await groupLinks.find(BACKEND, linkId);
    expect(relation?.knowSomeoneUserIds).toEqual([]);
  });

  it('idempotent: marking twice does not duplicate', async () => {
    const linkId = await shared(ANA);
    await setKnowSomeone.execute(ANA, BACKEND, linkId, { flagged: true });

    const state = await setKnowSomeone.execute(ANA, BACKEND, linkId, {
      flagged: true,
    });

    expect(state).toEqual({ flaggedByMe: true, count: 1 });
  });

  it('No miembro: 404 group_not_found and the set does not change', async () => {
    const linkId = await shared(ANA);
    await setKnowSomeone.execute(ANA, BACKEND, linkId, { flagged: true });

    await expect(
      setKnowSomeone.execute(STRANGER, BACKEND, linkId, { flagged: true }),
    ).rejects.toBeInstanceOf(CommentsGroupNotFound);
    await expect(
      setKnowSomeone.execute(ANA, UNKNOWN_GROUP, linkId, { flagged: true }),
    ).rejects.toBeInstanceOf(CommentsGroupNotFound);
    await expect(
      setKnowSomeone.execute(ANA, MALFORMED, linkId, { flagged: true }),
    ).rejects.toBeInstanceOf(CommentsGroupNotFound);

    const relation = await groupLinks.find(BACKEND, linkId);
    expect(relation?.knowSomeoneUserIds).toEqual([ANA]);
  });

  it('Relación inexistente: 404 link_not_found', async () => {
    await shared(ANA);
    const missing = objectId(50);

    await expect(
      setKnowSomeone.execute(ANA, BACKEND, missing, { flagged: true }),
    ).rejects.toBeInstanceOf(LinkNotFound);
    await expect(
      setKnowSomeone.execute(ANA, BACKEND, MALFORMED, { flagged: true }),
    ).rejects.toBeInstanceOf(LinkNotFound);
  });

  it('concurrencia básica: two members flag at once and count is 2', async () => {
    const linkId = await shared(ANA);

    const [ana, beto] = await Promise.all([
      setKnowSomeone.execute(ANA, BACKEND, linkId, { flagged: true }),
      setKnowSomeone.execute(BETO, BACKEND, linkId, { flagged: true }),
    ]);

    expect(ana.flaggedByMe).toBe(true);
    expect(beto.flaggedByMe).toBe(true);
    const relation = await groupLinks.find(BACKEND, linkId);
    expect([...(relation?.knowSomeoneUserIds ?? [])].sort()).toEqual(
      [ANA, BETO].sort(),
    );
    expect(relation?.knowSomeoneUserIds).toHaveLength(2);
  });
});

describe('ListGroupLinks knowSomeone', () => {
  it('always includes knowSomeone; count and flaggedByMe for a third member', async () => {
    const linkId = await shared(ANA);
    await setKnowSomeone.execute(ANA, BACKEND, linkId, { flagged: true });
    await setKnowSomeone.execute(BETO, BACKEND, linkId, { flagged: true });

    const page = await listGroupLinks.execute(CARLA, BACKEND, { limit: 20 });
    const item = page.items.find((link) => link.id === linkId);

    expect(item?.knowSomeone).toEqual({ flaggedByMe: false, count: 2 });
  });

  it('shows flaggedByMe true for who flagged', async () => {
    const linkId = await shared(ANA);
    await setKnowSomeone.execute(ANA, BACKEND, linkId, { flagged: true });

    const page = await listGroupLinks.execute(ANA, BACKEND, { limit: 20 });
    expect(page.items[0]?.knowSomeone).toEqual({
      flaggedByMe: true,
      count: 1,
    });
  });

  it('includes knowSomeone with count 0 when nobody flagged', async () => {
    await shared(ANA);

    const page = await listGroupLinks.execute(ANA, BACKEND, { limit: 20 });
    expect(page.items[0]?.knowSomeone).toEqual({
      flaggedByMe: false,
      count: 0,
    });
  });
});

describe('ListMyLinks omits knowSomeone', () => {
  it('private list never includes knowSomeone', async () => {
    const saved = await saveLink.execute(ANA, { url: JOB_PAGE });
    await saveLink.execute(ANA, { url: JOB_PAGE, groupId: BACKEND });
    const linkId = saved.link.id;
    await setKnowSomeone.execute(ANA, BACKEND, linkId, { flagged: true });

    const page = await listMyLinks.execute(ANA, { limit: 20 });
    const item = page.items.find((link) => link.id === linkId);

    expect(item).toBeDefined();
    expect(item).not.toHaveProperty('knowSomeone');
  });
});
