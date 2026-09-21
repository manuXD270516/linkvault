import { beforeEach, describe, expect, it } from 'vitest';
import type { JobLink } from '../domain/job-link';
import { LinksFacade } from './links.facade';
import { InMemoryGroupLinkRepository } from './testing/in-memory-group-link.repository';
import { InMemoryJobLinkRepository } from './testing/in-memory-job-link.repository';
import { InMemoryUserLinkRepository } from './testing/in-memory-user-link.repository';
import {
  enrichedPreview,
  jobLinkDraft,
  objectId,
} from './testing/link-fixtures';
import {
  IN_MEMORY_SESSION,
  InMemoryGroupMembership,
} from './testing/links-test-doubles';

// Escenarios de "Links disponibles para otros módulos" (spec links/sharing), con los repositorios en memoria.

const ANA = objectId(1);
const BETO = objectId(2);
const MINE = objectId(10);
const FOREIGN = objectId(11);
const now = new Date('2026-09-19T10:00:00.000Z');

let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let membership: InMemoryGroupMembership;
let facade: LinksFacade;
let privateLink: JobLink;
let groupLink: JobLink;
let foreignLink: JobLink;

beforeEach(async () => {
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  userLinks = new InMemoryUserLinkRepository(links);
  membership = new InMemoryGroupMembership()
    .withMember(MINE, ANA)
    .withMember(FOREIGN, BETO);
  facade = new LinksFacade(links, groupLinks, userLinks, membership);

  privateLink = links.seed(
    jobLinkDraft('https://www.linkedin.com/jobs/view/3811111111/'),
  );
  groupLink = links.seed(
    jobLinkDraft('https://www.linkedin.com/jobs/view/3822222222/'),
  );
  foreignLink = links.seed(
    jobLinkDraft('https://www.linkedin.com/jobs/view/3833333333/'),
  );
  await userLinks.save(
    { userId: ANA, linkId: privateLink.id, savedAt: now },
    IN_MEMORY_SESSION,
  );
  await groupLinks.seed({
    groupId: MINE,
    linkId: groupLink.id,
    sharedBy: ANA,
    sharedAt: now,
  });
  await groupLinks.seed({
    groupId: FOREIGN,
    linkId: foreignLink.id,
    sharedBy: BETO,
    sharedAt: now,
  });
});

describe('LinksFacade', () => {
  it('Otro módulo pregunta si alguien ve un link', async () => {
    await expect(facade.canRead(ANA, privateLink.id)).resolves.toBe(true);
    await expect(facade.canRead(ANA, groupLink.id)).resolves.toBe(true);
    await expect(facade.canRead(ANA, foreignLink.id)).resolves.toBe(false);
  });

  it('answers false for a link that does not exist or a malformed id', async () => {
    await expect(facade.canRead(ANA, objectId(999))).resolves.toBe(false);
    await expect(facade.canRead(ANA, 'no-es-un-id')).resolves.toBe(false);
  });

  it('Fichas de varios links a la vez', async () => {
    links.overwrite(groupLink.id, {
      previewStatus: 'enriched',
      ...enrichedPreview(ANA),
    });

    const cards = await facade.cardsOf([
      privateLink.id,
      groupLink.id,
      foreignLink.id,
      'no-es-un-id',
    ]);

    expect(cards).toHaveLength(3);
    expect(cards.find((card) => card.id === groupLink.id)).toEqual({
      id: groupLink.id,
      displayUrl: groupLink.displayUrl,
      platform: 'linkedin',
      previewStatus: 'enriched',
      title: 'Backend Engineer',
      company: 'Acme Bolivia',
    });
    expect(cards.find((card) => card.id === privateLink.id)).toEqual({
      id: privateLink.id,
      displayUrl: privateLink.displayUrl,
      platform: 'linkedin',
      previewStatus: 'pending',
    });
    expect(links.cardsOfCalls).toBe(1);
  });

  it('Qué links están en un grupo', async () => {
    const other = links.seed(
      jobLinkDraft('https://www.linkedin.com/jobs/view/3844444444/'),
    );
    await groupLinks.seed({
      groupId: MINE,
      linkId: other.id,
      sharedBy: ANA,
      sharedAt: now,
    });

    const shared = await facade.linkIdsSharedIn(MINE, [
      groupLink.id,
      other.id,
      foreignLink.id,
      'no-es-un-id',
    ]);

    expect([...shared].sort()).toEqual([groupLink.id, other.id].sort());
    expect(groupLinks.linkIdsInCalls).toBe(1);
  });

  it('answers nothing for a malformed group id', async () => {
    await expect(
      facade.linkIdsSharedIn('no-es-un-id', [groupLink.id]),
    ).resolves.toEqual(new Set());
  });

  it('matchJobSummaryOf exposes previewVersion, title and summary as description', async () => {
    const withPreview = links.seed({
      ...jobLinkDraft('https://www.linkedin.com/jobs/view/3855555555/'),
      previewStatus: 'enriched',
      previewVersion: 4,
      preview: {
        title: 'Backend Engineer',
        summary: 'Texto de la vacante',
      },
    });
    await userLinks.save(
      { userId: ANA, linkId: withPreview.id, savedAt: now },
      IN_MEMORY_SESSION,
    );

    await expect(facade.matchJobSummaryOf(withPreview.id)).resolves.toEqual({
      id: withPreview.id,
      previewVersion: 4,
      title: 'Backend Engineer',
      description: 'Texto de la vacante',
    });
    await expect(facade.matchJobSummaryOf('no-es-un-id')).resolves.toBeNull();
  });
});
