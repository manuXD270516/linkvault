import { LINK_PAGE_DEFAULT_LIMIT } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { GroupNotFound } from '../../groups/domain/errors';
import { InvalidCursor } from '../domain/errors';
import { ListGroupLinks } from './list-group-links.usecase';
import { ListMyLinks } from './list-my-links.usecase';
import { SaveLink } from './save-link.usecase';
import { InMemoryGroupLinkRepository } from './testing/in-memory-group-link.repository';
import { InMemoryJobLinkRepository } from './testing/in-memory-job-link.repository';
import { InMemoryUserLinkRepository } from './testing/in-memory-user-link.repository';
import {
  enrichedPreview,
  jobLinkDraft,
  objectId,
  pastedPreview,
} from './testing/link-fixtures';
import {
  IN_MEMORY_SESSION,
  InMemoryGroupMembership,
  InMemoryLinkUserDirectory,
  InMemoryOutbox,
  MovableClock,
} from './testing/links-test-doubles';

// `GET /api/groups/:id/links` y `GET /api/links/mine` (tarea 5.4 de job-links) con los dobles en memoria.

const ANA = objectId(1);
const BETO = objectId(2);
const STRANGER = objectId(3);
const BACKEND = objectId(10);
const STRANGERS = objectId(12);
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const OTHER_JOB = 'https://www.linkedin.com/jobs/view/3822222222/';

let clock: MovableClock;
let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let directory: InMemoryLinkUserDirectory;
let saveLink: SaveLink;
let listGroupLinks: ListGroupLinks;
let listMyLinks: ListMyLinks;

beforeEach(() => {
  clock = new MovableClock();
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  userLinks = new InMemoryUserLinkRepository(links);
  directory = new InMemoryLinkUserDirectory().set(ANA, 'Ana').set(BETO, 'Beto');
  const membership = new InMemoryGroupMembership()
    .withMember(BACKEND, ANA, 'owner', 'Backend Bolivia')
    .withMember(BACKEND, BETO)
    .withMember(STRANGERS, STRANGER, 'owner', 'De otro');
  saveLink = new SaveLink(
    links,
    groupLinks,
    userLinks,
    new InMemoryOutbox(),
    membership,
    directory,
    clock,
  );
  listGroupLinks = new ListGroupLinks(groupLinks, membership, directory);
  listMyLinks = new ListMyLinks(userLinks, directory);
});

describe('ListGroupLinks', () => {
  it('Miembro ve los links del grupo', async () => {
    await saveLink.execute(ANA, { url: JOB_PAGE, groupId: BACKEND });
    clock.advance(3_600_000);
    await saveLink.execute(BETO, { url: OTHER_JOB, groupId: BACKEND });

    const page = await listGroupLinks.execute(BETO, BACKEND, {
      limit: LINK_PAGE_DEFAULT_LIMIT,
    });

    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.displayUrl)).toEqual([
      OTHER_JOB,
      JOB_PAGE,
    ]);
    expect(page.items.map((item) => item.sharedBy?.displayName)).toEqual([
      'Beto',
      'Ana',
    ]);
    expect(page.items[0]?.previewStatus).toBe('pending');
    expect(page.nextCursor).toBeUndefined();
  });

  it('Extraño no ve los links', async () => {
    await saveLink.execute(ANA, { url: JOB_PAGE, groupId: BACKEND });

    await expect(
      listGroupLinks.execute(STRANGER, BACKEND, { limit: 20 }),
    ).rejects.toBeInstanceOf(GroupNotFound);
    await expect(
      listGroupLinks.execute(ANA, 'no-es-un-id', { limit: 20 }),
    ).rejects.toBeInstanceOf(GroupNotFound);
  });

  it('walks the pages with the cursor and keeps the same total', async () => {
    for (let index = 0; index < 5; index += 1) {
      await saveLink.execute(ANA, {
        url: `https://empresa.example/careers/${index}`,
        groupId: BACKEND,
      });
    }

    const first = await listGroupLinks.execute(ANA, BACKEND, { limit: 2 });
    const second = await listGroupLinks.execute(ANA, BACKEND, {
      limit: 2,
      ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
    });

    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(second.total).toBe(5);
    expect(second.items.map((item) => item.id)).not.toEqual(
      first.items.map((item) => item.id),
    );
  });

  it('rejects a manipulated cursor naming the field', async () => {
    await expect(
      listGroupLinks.execute(ANA, BACKEND, { limit: 20, cursor: 'roto' }),
    ).rejects.toBeInstanceOf(InvalidCursor);
  });

  it('resolves the names of the page in a single query', async () => {
    await saveLink.execute(ANA, { url: JOB_PAGE, groupId: BACKEND });
    await saveLink.execute(BETO, { url: OTHER_JOB, groupId: BACKEND });
    directory.calls = 0;

    await listGroupLinks.execute(ANA, BACKEND, { limit: 20 });

    expect(directory.calls).toBe(1);
  });

  it('shows a link whose sharer the directory does not know as Usuario', async () => {
    await saveLink.execute(BETO, { url: JOB_PAGE, groupId: BACKEND });
    directory = new InMemoryLinkUserDirectory();
    listGroupLinks = new ListGroupLinks(
      groupLinks,
      new InMemoryGroupMembership().withMember(BACKEND, ANA),
      directory,
    );

    const page = await listGroupLinks.execute(ANA, BACKEND, { limit: 20 });

    expect(page.items[0]?.sharedBy).toEqual({
      userId: BETO,
      displayName: 'Usuario',
    });
  });

  it('answers an empty page with total zero for a group without links', async () => {
    const page = await listGroupLinks.execute(ANA, BACKEND, { limit: 20 });

    expect(page).toEqual({ items: [], total: 0 });
  });
});

describe('ListMyLinks', () => {
  it('Lista privada', async () => {
    await saveLink.execute(ANA, { url: JOB_PAGE });
    await saveLink.execute(ANA, { url: OTHER_JOB, groupId: BACKEND });

    const page = await listMyLinks.execute(ANA, {
      limit: LINK_PAGE_DEFAULT_LIMIT,
    });

    expect(page.total).toBe(1);
    expect(page.items.map((item) => item.displayUrl)).toEqual([JOB_PAGE]);
    expect(page.items[0]?.sharedBy).toBeUndefined();
  });

  it('does not show what somebody else saved', async () => {
    await saveLink.execute(ANA, { url: JOB_PAGE });

    expect(await listMyLinks.execute(BETO, { limit: 20 })).toEqual({
      items: [],
      total: 0,
    });
  });

  it('walks the pages with the cursor', async () => {
    for (let index = 0; index < 3; index += 1) {
      await saveLink.execute(ANA, {
        url: `https://empresa.example/careers/${index}`,
      });
    }

    const first = await listMyLinks.execute(ANA, { limit: 2 });
    const second = await listMyLinks.execute(ANA, {
      limit: 2,
      ...(first.nextCursor === undefined ? {} : { cursor: first.nextCursor }),
    });

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeDefined();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    expect(second.total).toBe(3);
  });

  it('rejects a manipulated cursor naming the field', async () => {
    await expect(
      listMyLinks.execute(ANA, { limit: 20, cursor: 'roto' }),
    ).rejects.toBeInstanceOf(InvalidCursor);
  });
});

describe('read offers in the listings', () => {
  /**
   * Guarda `count` links de Ana en su lista privada, todos con campos escritos a mano; con `withPasted`, uno de cada
   * dos lleva además campos que pegó Beto.
   */
  async function seedEnriched(
    count: number,
    withPasted = false,
  ): Promise<void> {
    for (let index = 0; index < count; index += 1) {
      const link = links.seed({
        ...jobLinkDraft(`https://empresa.example/careers/leida-${index}`, {
          createdBy: ANA,
          now: clock.now(),
        }),
        previewStatus: 'manual',
        previewVersion: 2,
        ...(withPasted && index % 2 === 0
          ? pastedPreview(BETO, ANA)
          : enrichedPreview(ANA)),
      });
      await userLinks.save(
        { userId: ANA, linkId: link.id, savedAt: clock.now() },
        IN_MEMORY_SESSION,
      );
      clock.advance(1000);
    }
  }

  it('Oferta enriquecida', async () => {
    await seedEnriched(1);

    const page = await listMyLinks.execute(ANA, {
      limit: LINK_PAGE_DEFAULT_LIMIT,
    });
    const item = page.items[0];

    expect(item?.previewStatus).toBe('manual');
    expect(item?.previewVersion).toBe(2);
    expect(item?.preview?.title).toBe('Backend Engineer');
    expect(
      item?.previewSources?.company?.source === 'manual'
        ? item.previewSources.company.by
        : undefined,
    ).toEqual({ userId: ANA, displayName: 'Ana' });
  });

  it('resolves the names of twenty links with one query, not one per field', async () => {
    await seedEnriched(20);
    directory.calls = 0;

    const page = await listMyLinks.execute(ANA, {
      limit: LINK_PAGE_DEFAULT_LIMIT,
    });

    expect(page.items).toHaveLength(20);
    expect(directory.calls).toBe(1);
  });

  it('resolves pasted and manual authors of twenty links with one query', async () => {
    await seedEnriched(20, true);
    directory.calls = 0;

    const page = await listMyLinks.execute(ANA, {
      limit: LINK_PAGE_DEFAULT_LIMIT,
    });

    expect(page.items).toHaveLength(20);
    expect(directory.calls).toBe(1);
    const pasted = page.items.find(
      (item) => item.previewSources?.summary?.source === 'pasted',
    );
    const summary = pasted?.previewSources?.summary;
    expect(summary?.source === 'pasted' ? summary.by : undefined).toEqual({
      userId: BETO,
      displayName: 'Beto',
    });
  });

  it('a pending link keeps answering exactly like before', async () => {
    await saveLink.execute(ANA, { url: JOB_PAGE });
    directory.calls = 0;

    const page = await listMyLinks.execute(ANA, { limit: 20 });

    expect(page.items[0]?.previewStatus).toBe('pending');
    expect(page.items[0]?.preview).toBeUndefined();
    expect(page.items[0]?.previewSources).toBeUndefined();
    // Sin nada escrito a mano no hay ningún nombre que resolver: la lista privada sigue sin consultar el directorio.
    expect(directory.calls).toBe(0);
  });
});
