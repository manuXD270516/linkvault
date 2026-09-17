import { beforeEach, describe, expect, it } from 'vitest';
import { GroupNotFound } from '../../groups/domain/errors';
import { LinkNotFound, LinkRemovalForbidden } from '../domain/errors';
import { RemoveGroupLink } from './remove-group-link.usecase';
import { RemoveMyLink } from './remove-my-link.usecase';
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

// `DELETE /api/groups/:id/links/:linkId` y `DELETE /api/links/mine/:linkId` (tarea 5.5 de job-links).

const ANA = objectId(1);
const BETO = objectId(2);
const STRANGER = objectId(3);
const BACKEND = objectId(10);
const FRONTEND = objectId(11);
const VIDEO = 'https://video.example/watch?v=abc';
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';

let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let saveLink: SaveLink;
let removeGroupLink: RemoveGroupLink;
let removeMyLink: RemoveMyLink;

beforeEach(() => {
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  userLinks = new InMemoryUserLinkRepository(links);
  const membership = new InMemoryGroupMembership()
    .withMember(BACKEND, ANA, 'owner', 'Backend Bolivia')
    .withMember(BACKEND, BETO)
    .withMember(FRONTEND, BETO, 'owner', 'Frontend LatAm');
  saveLink = new SaveLink(
    links,
    groupLinks,
    userLinks,
    new InMemoryOutbox(),
    membership,
    new InMemoryLinkUserDirectory().set(ANA, 'Ana').set(BETO, 'Beto'),
    new MovableClock(),
  );
  removeGroupLink = new RemoveGroupLink(groupLinks, membership);
  removeMyLink = new RemoveMyLink(userLinks);
});

describe('RemoveGroupLink', () => {
  it('Quitar lo que no era una oferta', async () => {
    const { link } = await saveLink.execute(BETO, {
      url: VIDEO,
      groupId: BACKEND,
    });

    await expect(
      removeGroupLink.execute(BETO, BACKEND, link.id),
    ).resolves.toBeUndefined();

    expect((await groupLinks.listByGroup(BACKEND, { limit: 20 })).items).toEqual(
      [],
    );
    // La vacante sigue existiendo: quitar es de la relación, nunca del link.
    expect(await links.findById(link.id)).not.toBeNull();
  });

  it('El owner limpia el grupo', async () => {
    const { link } = await saveLink.execute(BETO, {
      url: VIDEO,
      groupId: BACKEND,
    });

    await expect(
      removeGroupLink.execute(ANA, BACKEND, link.id),
    ).resolves.toBeUndefined();
    expect(await groupLinks.countByGroup(BACKEND)).toBe(0);
  });

  it('Un miembro no quita lo de otro', async () => {
    const { link } = await saveLink.execute(ANA, {
      url: JOB_PAGE,
      groupId: BACKEND,
    });

    await expect(
      removeGroupLink.execute(BETO, BACKEND, link.id),
    ).rejects.toBeInstanceOf(LinkRemovalForbidden);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(1);
  });

  it('Quitar no destruye la vacante', async () => {
    const shared = await saveLink.execute(BETO, {
      url: JOB_PAGE,
      groupId: BACKEND,
    });
    await saveLink.execute(BETO, { url: JOB_PAGE, groupId: FRONTEND });

    await removeGroupLink.execute(BETO, BACKEND, shared.link.id);

    expect(await groupLinks.countByGroup(BACKEND)).toBe(0);
    expect(
      (await groupLinks.listByGroup(FRONTEND, { limit: 20 })).items.map(
        (item) => item.link.id,
      ),
    ).toEqual([shared.link.id]);
    expect(links.size).toBe(1);
  });

  it('answers group_not_found to somebody who is not a member', async () => {
    const { link } = await saveLink.execute(ANA, {
      url: JOB_PAGE,
      groupId: BACKEND,
    });

    await expect(
      removeGroupLink.execute(STRANGER, BACKEND, link.id),
    ).rejects.toBeInstanceOf(GroupNotFound);
    await expect(
      removeGroupLink.execute(ANA, 'no-es-un-id', link.id),
    ).rejects.toBeInstanceOf(GroupNotFound);
    expect(await groupLinks.countByGroup(BACKEND)).toBe(1);
  });

  it('answers link_not_found for a link that is not in that group', async () => {
    const { link } = await saveLink.execute(BETO, {
      url: JOB_PAGE,
      groupId: FRONTEND,
    });

    await expect(
      removeGroupLink.execute(ANA, BACKEND, link.id),
    ).rejects.toBeInstanceOf(LinkNotFound);
    await expect(
      removeGroupLink.execute(ANA, BACKEND, 'no-es-un-id'),
    ).rejects.toBeInstanceOf(LinkNotFound);
  });
});

describe('RemoveMyLink', () => {
  it('removes the link from the private list and never the vacancy', async () => {
    const { link } = await saveLink.execute(ANA, { url: VIDEO });

    await expect(removeMyLink.execute(ANA, link.id)).resolves.toBeUndefined();

    expect(await userLinks.countByUser(ANA)).toBe(0);
    expect(await links.findById(link.id)).not.toBeNull();
  });

  it('does not touch the private list of somebody else', async () => {
    const { link } = await saveLink.execute(ANA, { url: VIDEO });

    await expect(removeMyLink.execute(BETO, link.id)).rejects.toBeInstanceOf(
      LinkNotFound,
    );
    expect(await userLinks.countByUser(ANA)).toBe(1);
  });

  it('answers link_not_found for a link that was not in the list', async () => {
    const { link } = await saveLink.execute(ANA, {
      url: JOB_PAGE,
      groupId: BACKEND,
    });

    await expect(removeMyLink.execute(ANA, link.id)).rejects.toBeInstanceOf(
      LinkNotFound,
    );
    await expect(
      removeMyLink.execute(ANA, 'no-es-un-id'),
    ).rejects.toBeInstanceOf(LinkNotFound);
  });
});
