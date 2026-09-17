import { beforeEach, describe, expect, it } from 'vitest';
import { SaveLink } from './save-link.usecase';
import { InMemoryGroupLinkRepository } from './testing/in-memory-group-link.repository';
import { InMemoryJobLinkRepository } from './testing/in-memory-job-link.repository';
import { InMemoryUserLinkRepository } from './testing/in-memory-user-link.repository';
import { objectId } from './testing/link-fixtures';
import {
  InMemoryGroupMembership,
  InMemoryLinkUserDirectory,
  InMemoryOutbox,
  MovableClock,
} from './testing/links-test-doubles';

// Aviso "ya lo tienes en otro grupo" de `POST /api/links` (tarea 5.2 de job-links). Los grupos del usuario se resuelven
// una sola vez por petición y las relaciones se leen de una sola consulta (D4), no una por grupo.

const ANA = objectId(1);
const BETO = objectId(2);
const BACKEND = objectId(10);
const FRONTEND = objectId(11);
const STRANGERS = objectId(12);
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const SEARCH_PAGE =
  'https://www.linkedin.com/jobs/search/?currentJobId=3811111111';

let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let membership: InMemoryGroupMembership;
let saveLink: SaveLink;

beforeEach(() => {
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  membership = new InMemoryGroupMembership()
    .withMember(BACKEND, ANA, 'owner', 'Backend Bolivia')
    .withMember(FRONTEND, ANA, 'owner', 'Frontend LatAm')
    .withMember(STRANGERS, BETO, 'owner', 'De Beto');
  saveLink = new SaveLink(
    links,
    groupLinks,
    new InMemoryUserLinkRepository(links),
    new InMemoryOutbox(),
    membership,
    new InMemoryLinkUserDirectory().set(ANA, 'Ana').set(BETO, 'Beto'),
    new MovableClock(),
  );
});

describe('alreadyInGroups', () => {
  it('El link ya estaba en otro grupo propio', async () => {
    await saveLink.execute(ANA, { url: JOB_PAGE, groupId: BACKEND });

    const response = await saveLink.execute(ANA, {
      url: SEARCH_PAGE,
      groupId: FRONTEND,
    });

    expect(response.alreadyInGroups).toEqual([
      { id: BACKEND, name: 'Backend Bolivia' },
    ]);
  });

  it('El link está en un grupo ajeno', async () => {
    await saveLink.execute(BETO, { url: JOB_PAGE, groupId: STRANGERS });

    const response = await saveLink.execute(ANA, {
      url: SEARCH_PAGE,
      groupId: BACKEND,
    });

    expect(response.alreadyInGroups).toEqual([]);
  });

  it('never names the destination group itself', async () => {
    await saveLink.execute(ANA, { url: JOB_PAGE, groupId: BACKEND });

    const again = await saveLink.execute(ANA, {
      url: JOB_PAGE,
      groupId: BACKEND,
    });

    expect(again.shared).toBe('already_there');
    expect(again.alreadyInGroups).toEqual([]);
  });

  it('names every own group that has it, also when saving in private', async () => {
    await saveLink.execute(ANA, { url: JOB_PAGE, groupId: BACKEND });
    await saveLink.execute(ANA, { url: JOB_PAGE, groupId: FRONTEND });

    const response = await saveLink.execute(ANA, { url: SEARCH_PAGE });

    expect(response.alreadyInGroups).toEqual([
      { id: BACKEND, name: 'Backend Bolivia' },
      { id: FRONTEND, name: 'Frontend LatAm' },
    ]);
  });

  it('is empty for a user without groups', async () => {
    const alone = objectId(99);

    const response = await saveLink.execute(alone, { url: JOB_PAGE });

    expect(response.alreadyInGroups).toEqual([]);
  });

  it('resolves the groups of the user once and reads the relations once', async () => {
    await saveLink.execute(ANA, { url: JOB_PAGE, groupId: BACKEND });
    membership.groupsOfCalls = 0;
    groupLinks.groupsWithLinkCalls = 0;

    await saveLink.execute(ANA, { url: SEARCH_PAGE, groupId: FRONTEND });

    // Una sola resolución de grupos y una sola consulta de relaciones, sean 2 grupos o 20 (D4).
    expect(membership.groupsOfCalls).toBe(1);
    expect(groupLinks.groupsWithLinkCalls).toBe(1);
  });

  it('does not read the relations at all when the user has no other group', async () => {
    const alone = objectId(98);
    membership.withMember(objectId(20), alone, 'owner', 'Solo');
    groupLinks.groupsWithLinkCalls = 0;

    await saveLink.execute(alone, { url: JOB_PAGE, groupId: objectId(20) });

    expect(groupLinks.groupsWithLinkCalls).toBe(0);
  });
});
