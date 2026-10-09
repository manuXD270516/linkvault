import {
  SEARCH_UPSERT_EVENT_TYPE,
  searchContentHash,
  searchDocumentId,
  type SearchUpsertPayload,
} from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createSearchContentForTests,
  createSearchFacadeForTests,
  type SearchIndexDocument,
} from '../../search/application/testing/search-test-doubles';
import { InvalidExpiresAt, LinkNotFound } from '../domain/errors';
import { ReopenJobLink } from './reopen-job-link.usecase';
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
  InMemoryLinkEnrichedPublisher,
  InMemoryLinkUserDirectory,
  InMemoryOutbox,
  MovableClock,
} from './testing/links-test-doubles';

// `POST /api/links/:id/reopen` (ADR-041 / tasks 2.2–2.3).

const ANA = objectId(1);
const BETO = objectId(2);
const STRANGER = objectId(3);
const BACKEND = objectId(10);
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const NOW = new Date('2026-09-23T12:00:00.000Z');
const YESTERDAY = '2026-09-22';
const TOMORROW = '2026-09-24';
const NEXT_WEEK = '2026-10-01';

let clock: MovableClock;
let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let directory: InMemoryLinkUserDirectory;
let membership: InMemoryGroupMembership;
let publisher: InMemoryLinkEnrichedPublisher;
let reopen: ReopenJobLink;

beforeEach(() => {
  clock = new MovableClock(NOW);
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  userLinks = new InMemoryUserLinkRepository(links);
  directory = new InMemoryLinkUserDirectory().set(ANA, 'Ana').set(BETO, 'Beto');
  membership = new InMemoryGroupMembership()
    .withMember(BACKEND, ANA, 'owner', 'Backend Bolivia')
    .withMember(BACKEND, BETO);
  publisher = new InMemoryLinkEnrichedPublisher();
  reopen = new ReopenJobLink(
    links,
    groupLinks,
    userLinks,
    membership,
    directory,
    clock,
    publisher,
    noopConnection(),
  );
});

function noopConnection(): never {
  return {
    startSession: async () => ({
      withTransaction: async (fn: () => Promise<unknown>) => fn(),
      endSession: async () => undefined,
    }),
  } as never;
}

async function seedClosed(options: {
  readonly reason: 'calendar' | 'recheck';
  readonly expiresAt?: string | null;
}): Promise<string> {
  const preview = enrichedPreview(ANA);
  const link = links.seed({
    ...jobLinkDraft(JOB_PAGE, { createdBy: ANA, now: clock.now() }),
    previewStatus: 'enriched',
    previewVersion: 2,
    ...preview,
    preview: {
      ...preview.preview,
      ...(options.expiresAt === undefined
        ? { expiresAt: NEXT_WEEK }
        : { expiresAt: options.expiresAt }),
    },
    closedAt: new Date('2026-09-22T18:00:00.000Z'),
    closedReason: options.reason,
    lastFreshnessCheckAt: new Date('2026-09-22T18:00:00.000Z'),
  });
  await groupLinks.share(
    {
      groupId: BACKEND,
      linkId: link.id,
      sharedBy: ANA,
      sharedAt: clock.now(),
    },
    IN_MEMORY_SESSION,
  );
  return link.id;
}

describe('ReopenJobLink', () => {
  it('reopens a recheck-closed link without body', async () => {
    const linkId = await seedClosed({ reason: 'recheck' });

    const summary = await reopen.execute(ANA, linkId, {});

    expect(summary.closedAt).toBeUndefined();
    expect(summary.closedReason).toBeUndefined();
    const stored = await links.findById(linkId);
    expect(stored?.closedAt).toBeUndefined();
    expect(stored?.closedReason).toBeUndefined();
    expect(stored?.lastFreshnessCheckAt?.toISOString()).toBe(NOW.toISOString());
    expect(publisher.published).toEqual([
      { linkId, previewStatus: 'enriched', previewVersion: 2 },
    ]);
  });

  it('rejects calendar reopen without a future expiresAt', async () => {
    const linkId = await seedClosed({
      reason: 'calendar',
      expiresAt: YESTERDAY,
    });

    await expect(reopen.execute(ANA, linkId, {})).rejects.toBeInstanceOf(
      InvalidExpiresAt,
    );
    expect((await links.findById(linkId))?.closedAt).toBeDefined();
    expect(publisher.published).toEqual([]);
  });

  it('reopens calendar with a future expiresAt (manual provenance)', async () => {
    const linkId = await seedClosed({
      reason: 'calendar',
      expiresAt: YESTERDAY,
    });

    const summary = await reopen.execute(ANA, linkId, {
      expiresAt: TOMORROW,
    });

    expect(summary.closedAt).toBeUndefined();
    expect(summary.preview?.expiresAt).toBe(TOMORROW);
    expect(summary.previewSources?.expiresAt?.source).toBe('manual');
    expect(summary.previewStatus).toBe('manual');
    expect((await links.findById(linkId))?.previewVersion).toBe(3);
  });

  it('is idempotent when already open (even with past expiresAt)', async () => {
    const preview = enrichedPreview(ANA);
    const link = links.seed({
      ...jobLinkDraft(JOB_PAGE, { createdBy: ANA, now: clock.now() }),
      previewStatus: 'enriched',
      previewVersion: 2,
      ...preview,
      preview: { ...preview.preview, expiresAt: YESTERDAY },
    });
    await userLinks.save(
      { userId: ANA, linkId: link.id, savedAt: clock.now() },
      IN_MEMORY_SESSION,
    );
    const before = await links.findById(link.id);

    const summary = await reopen.execute(ANA, link.id, {
      expiresAt: TOMORROW,
    });

    expect(summary.closedAt).toBeUndefined();
    expect(summary.preview?.expiresAt).toBe(YESTERDAY);
    expect(await links.findById(link.id)).toEqual(before);
    expect(publisher.published).toEqual([]);
  });

  it('returns link_not_found when not readable', async () => {
    const linkId = await seedClosed({ reason: 'recheck' });

    await expect(reopen.execute(STRANGER, linkId, {})).rejects.toBeInstanceOf(
      LinkNotFound,
    );
    await expect(reopen.execute(ANA, objectId(999), {})).rejects.toBeInstanceOf(
      LinkNotFound,
    );
  });

  it('does not reopen applications in expired (no apps port / D4)', async () => {
    const linkId = await seedClosed({ reason: 'recheck' });
    // ReopenJobLink no inyecta APPLICATION_REPOSITORY: no puede mutar postulaciones.
    const expiredApps = [{ linkId, status: 'expired' as const }];

    await reopen.execute(ANA, linkId, {});

    expect(expiredApps[0]?.status).toBe('expired');
  });

  it('openOnly hits after reopen with closedAt null in indexed doc', async () => {
    const linkId = await seedClosed({ reason: 'recheck' });
    const outbox = new InMemoryOutbox();
    const { facade, meili } = createSearchFacadeForTests(outbox, true);
    const membershipSearch = {
      groupIdsOf: async () => [BACKEND],
    };
    const searchContent = createSearchContentForTests(meili, membershipSearch);
    reopen = new ReopenJobLink(
      links,
      groupLinks,
      userLinks,
      membership,
      directory,
      clock,
      publisher,
      noopConnection(),
      facade,
    );

    const closedIso = '2026-09-22T18:00:00.000Z';
    await meili.upsert([
      {
        id: searchDocumentId('job_preview', linkId),
        docType: 'job_preview',
        ownerUserId: ANA,
        groupIds: [BACKEND],
        visibilityScope: 'owner_and_groups',
        updatedAt: NOW.getTime(),
        embeddingStatus: 'missing',
        title: 'Backend Engineer',
        linkId,
        closedAt: closedIso,
      },
    ]);

    await reopen.execute(BETO, linkId, {});

    const events = outbox.appended;
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(SEARCH_UPSERT_EVENT_TYPE);
    expect(events[0]?.payload as SearchUpsertPayload).toMatchObject({
      docType: 'job_preview',
      aggregateId: linkId,
      reason: 'preview_updated',
      contentHash: searchContentHash(
        `job_preview:${linkId}:reopen:${NOW.toISOString()}`,
      ),
    });

    const stored = await links.findById(linkId);
    const openDoc: SearchIndexDocument = {
      id: searchDocumentId('job_preview', linkId),
      docType: 'job_preview',
      ownerUserId: ANA,
      groupIds: [BACKEND],
      visibilityScope: 'owner_and_groups',
      updatedAt: NOW.getTime(),
      embeddingStatus: 'missing',
      title: stored?.preview?.title,
      linkId,
      closedAt: null,
    };
    await meili.upsert([openDoc]);

    const result = await searchContent.execute(BETO, {
      q: 'Backend',
      openOnly: true,
      limit: 10,
      offset: 0,
      mode: 'fulltext',
    });
    expect(result.hits.map((hit) => hit.linkId)).toContain(linkId);
    expect(meili.documents.get(openDoc.id)?.closedAt).toBeNull();
  });

  it('allows a member who can see the link to reopen', async () => {
    const linkId = await seedClosed({ reason: 'recheck' });
    const summary = await reopen.execute(BETO, linkId, {});
    expect(summary.closedAt).toBeUndefined();
  });

  it('rejects recheck with past expiresAt unless body fixes it', async () => {
    const linkId = await seedClosed({
      reason: 'recheck',
      expiresAt: YESTERDAY,
    });
    await expect(reopen.execute(ANA, linkId, {})).rejects.toBeInstanceOf(
      InvalidExpiresAt,
    );
    const summary = await reopen.execute(ANA, linkId, { expiresAt: null });
    expect(summary.closedAt).toBeUndefined();
    expect(summary.preview?.expiresAt).toBeNull();
  });
});

describe('ReopenJobLink provenance names (H1)', () => {
  const CARLA = objectId(4);

  it('response hides authors who share no group with the caller', async () => {
    const linkId = await seedClosed({ reason: 'recheck' });
    await userLinks.save(
      { userId: CARLA, linkId, savedAt: clock.now() },
      IN_MEMORY_SESSION,
    );

    const summary = await reopen.execute(CARLA, linkId, {});
    const company = summary.previewSources?.company;

    expect(company?.source === 'manual' ? company.by : undefined).toBeNull();
    const sources = JSON.stringify(summary.previewSources);
    expect(sources).not.toContain(ANA);
    expect(sources).not.toContain('Ana');
  });
});
