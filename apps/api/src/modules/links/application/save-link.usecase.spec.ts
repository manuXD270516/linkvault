import { beforeEach, describe, expect, it } from 'vitest';
import { GroupNotFound } from '../../groups/domain/errors';
import { InvalidUrl } from '../domain/errors';
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

// `POST /api/links` (tarea 5.1 de job-links) con los dobles en memoria de sus puertos.

const ANA = objectId(1);
const BETO = objectId(2);
const BACKEND = objectId(10);
const FRONTEND = objectId(11);
const STRANGERS = objectId(12);
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const SEARCH_PAGE =
  'https://www.linkedin.com/jobs/search/?currentJobId=3811111111';
const OTHER_JOB = 'https://www.linkedin.com/jobs/view/3822222222/';

let clock: MovableClock;
let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let outbox: InMemoryOutbox;
let membership: InMemoryGroupMembership;
let directory: InMemoryLinkUserDirectory;
let saveLink: SaveLink;

beforeEach(() => {
  clock = new MovableClock();
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  userLinks = new InMemoryUserLinkRepository(links);
  outbox = new InMemoryOutbox();
  membership = new InMemoryGroupMembership()
    .withMember(BACKEND, ANA, 'owner', 'Backend Bolivia')
    .withMember(BACKEND, BETO)
    .withMember(FRONTEND, ANA, 'owner', 'Frontend LatAm')
    .withMember(STRANGERS, BETO, 'owner', 'De Beto');
  directory = new InMemoryLinkUserDirectory().set(ANA, 'Ana').set(BETO, 'Beto');
  saveLink = new SaveLink(
    links,
    groupLinks,
    userLinks,
    outbox,
    membership,
    directory,
    clock,
  );
});

describe('SaveLink', () => {
  it('Guardar en un grupo', async () => {
    const response = await saveLink.execute(ANA, {
      url: JOB_PAGE,
      groupId: BACKEND,
    });

    expect(response.created).toBe(true);
    expect(response.shared).toBe('created');
    expect(response.link.previewStatus).toBe('pending');
    expect(response.link.platform).toBe('linkedin');
    expect(response.link.displayUrl).toBe(JOB_PAGE);
    expect(response.link.normalizedUrl).toBe(
      'https://linkedin.com/jobs/view/3811111111',
    );
    expect(response.link.sharedBy).toEqual({ userId: ANA, displayName: 'Ana' });
    expect(response.alreadyInGroups).toEqual([]);

    const page = await groupLinks.listByGroup(BACKEND, { limit: 20 });
    expect(page.items.map((item) => item.link.id)).toEqual([response.link.id]);
  });

  it('writes one outbox event for the new vacancy, inside the transaction', async () => {
    const response = await saveLink.execute(ANA, {
      url: JOB_PAGE,
      groupId: BACKEND,
    });

    expect(outbox.appended).toEqual([
      {
        type: 'LinkCreated.v1',
        payload: { linkId: response.link.id, previewVersion: 1 },
      },
    ]);
    expect(outbox.allWrittenWith(groupLinks.lastSession ?? {})).toBe(true);
  });

  it('Vacante conocida, nueva en mi grupo', async () => {
    await saveLink.execute(BETO, { url: JOB_PAGE, groupId: STRANGERS });

    const response = await saveLink.execute(ANA, {
      url: SEARCH_PAGE,
      groupId: BACKEND,
    });

    expect(response.created).toBe(false);
    expect(response.shared).toBe('created');
    expect(links.size).toBe(1);
    // La vacante ya estaba enriquecida (o en cola): no hace falta un segundo evento.
    expect(outbox.size).toBe(1);
    expect(response.alreadyInGroups).toEqual([]);
  });

  it('Guardar en privado', async () => {
    const response = await saveLink.execute(ANA, { url: JOB_PAGE });

    expect(response.created).toBe(true);
    expect(response.shared).toBe('created');
    expect(response.link.sharedBy).toBeUndefined();
    expect(response.sharedBy).toBeUndefined();
    expect(await userLinks.countByUser(ANA)).toBe(1);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(0);
    expect(await groupLinks.countByGroup(FRONTEND)).toBe(0);
  });

  it('keeps the private list idempotent: saving the same vacancy twice', async () => {
    await saveLink.execute(ANA, { url: JOB_PAGE });
    const again = await saveLink.execute(ANA, { url: SEARCH_PAGE });

    expect(again.created).toBe(false);
    expect(again.shared).toBe('already_there');
    expect(await userLinks.countByUser(ANA)).toBe(1);
  });

  it('URL no reconocida', async () => {
    await expect(
      saveLink.execute(ANA, { url: 'no-es-una-url', groupId: BACKEND }),
    ).rejects.toBeInstanceOf(InvalidUrl);
    await expect(
      saveLink.execute(ANA, { url: 'ftp://example.com/job' }),
    ).rejects.toBeInstanceOf(InvalidUrl);

    expect(links.size).toBe(0);
    expect(outbox.size).toBe(0);
  });

  it('rejects a url longer than the maximum with invalid_url too', async () => {
    const tooLong = `https://example.com/${'a'.repeat(2048)}`;

    await expect(saveLink.execute(ANA, { url: tooLong })).rejects.toBeInstanceOf(
      InvalidUrl,
    );
    expect(links.size).toBe(0);
  });

  it('Compartir sin duplicar', async () => {
    const first = await saveLink.execute(ANA, {
      url: JOB_PAGE,
      groupId: BACKEND,
    });
    clock.advance(3_600_000);

    const second = await saveLink.execute(BETO, {
      url: SEARCH_PAGE,
      groupId: BACKEND,
    });

    expect(second.created).toBe(false);
    expect(second.shared).toBe('already_there');
    expect(second.sharedBy).toEqual({ userId: ANA, displayName: 'Ana' });
    expect(second.link.id).toBe(first.link.id);
    expect(second.link.sharedAt).toBe(first.link.sharedAt);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(1);
  });

  it('shares the same vacancy in two groups without creating a second one', async () => {
    const first = await saveLink.execute(ANA, {
      url: JOB_PAGE,
      groupId: BACKEND,
    });
    const second = await saveLink.execute(ANA, {
      url: SEARCH_PAGE,
      groupId: FRONTEND,
    });

    expect(second.link.id).toBe(first.link.id);
    expect(second.shared).toBe('created');
    expect(links.size).toBe(1);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(1);
    expect(await groupLinks.countByGroup(FRONTEND)).toBe(1);
  });

  it('Grupo ajeno', async () => {
    await expect(
      saveLink.execute(ANA, { url: JOB_PAGE, groupId: STRANGERS }),
    ).rejects.toBeInstanceOf(GroupNotFound);
    await expect(
      saveLink.execute(ANA, { url: JOB_PAGE, groupId: 'no-es-un-id' }),
    ).rejects.toBeInstanceOf(GroupNotFound);

    // Ni la vacante ni su evento llegan a escribirse.
    expect(links.size).toBe(0);
    expect(outbox.size).toBe(0);
  });

  it('names whoever shared first, even when the directory does not know them', async () => {
    const unknown = objectId(99);
    membership.withMember(BACKEND, unknown);
    await saveLink.execute(unknown, { url: JOB_PAGE, groupId: BACKEND });

    const response = await saveLink.execute(ANA, {
      url: JOB_PAGE,
      groupId: BACKEND,
    });

    expect(response.sharedBy).toEqual({
      userId: unknown,
      displayName: 'Usuario',
    });
  });

  it('gives different vacancies to two different job ids', async () => {
    const first = await saveLink.execute(ANA, {
      url: JOB_PAGE,
      groupId: BACKEND,
    });
    const other = await saveLink.execute(ANA, {
      url: OTHER_JOB,
      groupId: BACKEND,
    });

    expect(other.link.id).not.toBe(first.link.id);
    expect(links.size).toBe(2);
    expect(outbox.size).toBe(2);
  });
});
