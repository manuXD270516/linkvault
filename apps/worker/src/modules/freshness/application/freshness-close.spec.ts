import { describe, expect, it } from 'vitest';
import type { LinkEnrichedEvent } from '@linkvault/shared';
import { EnrichLinkUseCase } from '../../enrichment/application/enrich-link.usecase';
import type { ExtractPreviewService } from '../../enrichment/application/extract-preview.service';
import {
  FixedClock,
  InMemoryEnrichmentNotifier,
  InMemoryLinkRepository,
  InMemorySnapshotStore,
} from '../../enrichment/application/testing/enrichment-test-doubles';
import { CloseJobLinkUseCase } from './close-job-link.usecase';
import type {
  ExpireApplicationsForClosedLink,
  FreshnessLinkRow,
  FreshnessLinkStore,
} from './ports/freshness.ports';
import type { SearchIndexJobPublisher } from '../../search/application/ports/search-index-job-publisher.port';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const LINK_ID = '507f1f77bcf86cd799439011';

function extractOf(
  result: Awaited<ReturnType<ExtractPreviewService['run']>>,
): ExtractPreviewService {
  return { run: () => Promise.resolve(result) } as unknown as ExtractPreviewService;
}

describe('EnrichLinkUseCase freshness close signals', () => {
  it('closes on freshness + not_found without writing failed empty', async () => {
    const links = new InMemoryLinkRepository();
    links.put({
      id: LINK_ID,
      displayUrl: 'https://www.getonbrd.com/jobs/1',
      originalUrls: ['https://www.getonbrd.com/jobs/1'],
      createdBy: 'u1',
      previewStatus: 'enriched',
      previewVersion: 2,
      preview: { title: 'Backend', company: 'Acme' },
      previewSources: {},
    });
    const notifier = new InMemoryEnrichmentNotifier();
    const closed: string[] = [];
    const useCase = new EnrichLinkUseCase(
      links,
      extractOf({ kind: 'failed', reason: 'not_found' }),
      new InMemorySnapshotStore(),
      notifier,
      new FixedClock(NOW),
      5_000,
      {
        execute: ({ linkId }) => {
          closed.push(linkId);
          return Promise.resolve({ closed: true, alreadyClosed: false });
        },
      },
    );

    const result = await useCase.execute({
      linkId: LINK_ID,
      previewVersion: 2,
      deferrals: 0,
      triggeredBy: 'freshness',
    });

    expect(result).toMatchObject({ kind: 'done', closed: true });
    expect(closed).toEqual([LINK_ID]);
    expect(links.writes).toHaveLength(0);
    expect(links.peek(LINK_ID)?.previewStatus).toBe('enriched');
    expect(links.peek(LINK_ID)?.preview).toEqual({
      title: 'Backend',
      company: 'Acme',
    });
  });

  it('closes on freshness + isJobPosting false', async () => {
    const links = new InMemoryLinkRepository();
    links.put({
      id: LINK_ID,
      displayUrl: 'https://www.getonbrd.com/jobs/1',
      originalUrls: ['https://www.getonbrd.com/jobs/1'],
      createdBy: 'u1',
      previewStatus: 'enriched',
      previewVersion: 2,
      preview: { title: 'Backend' },
      previewSources: {},
    });
    const closed: string[] = [];
    const useCase = new EnrichLinkUseCase(
      links,
      extractOf({
        kind: 'extracted',
        draft: {},
        ran: ['ai:extract-job'],
        isJobPosting: false,
        html: '<html/>',
      }),
      new InMemorySnapshotStore(),
      new InMemoryEnrichmentNotifier(),
      new FixedClock(NOW),
      5_000,
      {
        execute: ({ linkId }) => {
          closed.push(linkId);
          return Promise.resolve({ closed: true, alreadyClosed: false });
        },
      },
    );

    await useCase.execute({
      linkId: LINK_ID,
      previewVersion: 2,
      deferrals: 0,
      triggeredBy: 'freshness',
    });
    expect(closed).toEqual([LINK_ID]);
  });

  it('does not close on freshness + http_error', async () => {
    const links = new InMemoryLinkRepository();
    links.put({
      id: LINK_ID,
      displayUrl: 'https://www.getonbrd.com/jobs/1',
      originalUrls: ['https://www.getonbrd.com/jobs/1'],
      createdBy: 'u1',
      previewStatus: 'enriched',
      previewVersion: 2,
      preview: { title: 'Backend' },
      previewSources: {},
    });
    const closed: string[] = [];
    const useCase = new EnrichLinkUseCase(
      links,
      extractOf({ kind: 'failed', reason: 'http_error' }),
      new InMemorySnapshotStore(),
      new InMemoryEnrichmentNotifier(),
      new FixedClock(NOW),
      5_000,
      {
        execute: ({ linkId }) => {
          closed.push(linkId);
          return Promise.resolve({ closed: true, alreadyClosed: false });
        },
      },
    );

    const result = await useCase.execute({
      linkId: LINK_ID,
      previewVersion: 2,
      deferrals: 0,
      triggeredBy: 'freshness',
    });
    expect(closed).toHaveLength(0);
    expect(result).toMatchObject({ kind: 'done', previewStatus: 'failed' });
    expect(links.peek(LINK_ID)?.closedAt).toBeUndefined();
  });

  it('does not close on freshness + rate_limited (429)', async () => {
    const links = new InMemoryLinkRepository();
    links.put({
      id: LINK_ID,
      displayUrl: 'https://www.getonbrd.com/jobs/1',
      originalUrls: ['https://www.getonbrd.com/jobs/1'],
      createdBy: 'u1',
      previewStatus: 'enriched',
      previewVersion: 2,
      preview: { title: 'Backend', company: 'Acme' },
      previewSources: {},
    });
    const closed: string[] = [];
    const useCase = new EnrichLinkUseCase(
      links,
      extractOf({ kind: 'failed', reason: 'rate_limited' }),
      new InMemorySnapshotStore(),
      new InMemoryEnrichmentNotifier(),
      new FixedClock(NOW),
      5_000,
      {
        execute: ({ linkId }) => {
          closed.push(linkId);
          return Promise.resolve({ closed: true, alreadyClosed: false });
        },
      },
    );

    const result = await useCase.execute({
      linkId: LINK_ID,
      previewVersion: 2,
      deferrals: 0,
      triggeredBy: 'freshness',
    });
    expect(closed).toHaveLength(0);
    expect(result).toMatchObject({ kind: 'done', previewStatus: 'failed' });
    expect(links.peek(LINK_ID)?.closedAt).toBeUndefined();
    expect(links.peek(LINK_ID)?.preview).toEqual({
      title: 'Backend',
      company: 'Acme',
    });
  });

  it('does not close on login wall when JSON-LD JobPosting is present (AI false OR true)', async () => {
    // Cadena OR: AI dijo isJobPosting false, pero JsonLd encontró JobPosting → final true.
    const links = new InMemoryLinkRepository();
    links.put({
      id: LINK_ID,
      displayUrl: 'https://www.getonbrd.com/jobs/1',
      originalUrls: ['https://www.getonbrd.com/jobs/1'],
      createdBy: 'u1',
      previewStatus: 'enriched',
      previewVersion: 2,
      preview: { title: 'Backend', company: 'Acme' },
      previewSources: {},
    });
    const closed: string[] = [];
    const useCase = new EnrichLinkUseCase(
      links,
      extractOf({
        kind: 'extracted',
        draft: {},
        ran: ['json-ld', 'ai:extract-job'],
        isJobPosting: true,
        html: '<html><body>Please log in<script type="application/ld+json">{"@type":"JobPosting","title":"Backend"}</script></body></html>',
      }),
      new InMemorySnapshotStore(),
      new InMemoryEnrichmentNotifier(),
      new FixedClock(NOW),
      5_000,
      {
        execute: ({ linkId }) => {
          closed.push(linkId);
          return Promise.resolve({ closed: true, alreadyClosed: false });
        },
      },
    );

    await useCase.execute({
      linkId: LINK_ID,
      previewVersion: 2,
      deferrals: 0,
      triggeredBy: 'freshness',
    });
    expect(closed).toHaveLength(0);
    expect(links.peek(LINK_ID)?.closedAt).toBeUndefined();
  });

  it('first enrich not_found becomes failed non-retryable without closing', async () => {
    const links = new InMemoryLinkRepository();
    links.put({
      id: LINK_ID,
      displayUrl: 'https://www.getonbrd.com/jobs/1',
      originalUrls: ['https://www.getonbrd.com/jobs/1'],
      createdBy: 'u1',
      previewStatus: 'pending',
      previewVersion: 1,
      preview: {},
      previewSources: {},
    });
    const closed: string[] = [];
    const useCase = new EnrichLinkUseCase(
      links,
      extractOf({ kind: 'failed', reason: 'not_found' }),
      new InMemorySnapshotStore(),
      new InMemoryEnrichmentNotifier(),
      new FixedClock(NOW),
      5_000,
      {
        execute: ({ linkId }) => {
          closed.push(linkId);
          return Promise.resolve({ closed: true, alreadyClosed: false });
        },
      },
    );

    const result = await useCase.execute({
      linkId: LINK_ID,
      previewVersion: 1,
      deferrals: 0,
    });
    expect(closed).toHaveLength(0);
    expect(result).toMatchObject({ kind: 'done', previewStatus: 'failed' });
    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe('not_found');
  });
});

describe('CloseJobLinkUseCase', () => {
  it('closes idempotently, publishes SSE, expires apps and upserts search', async () => {
    const store: FreshnessLinkStore = {
      listOpenEligible: () => Promise.resolve([]),
      listCascadePending: () => Promise.resolve([]),
      findById: (linkId) =>
        Promise.resolve({
          linkId,
          previewStatus: 'enriched',
          previewVersion: 2,
          preview: { title: 'X' },
          platform: 'getonboard',
          displayUrl: 'https://example.com/1',
          updatedAt: NOW,
        } satisfies FreshnessLinkRow),
      closeIfOpen: () => Promise.resolve(true),
      touchFreshnessCheck: () => Promise.resolve(),
    };
    const published: LinkEnrichedEvent[] = [];
    const expireCalls: string[] = [];
    const searchUpserts: string[] = [];
    const expire: ExpireApplicationsForClosedLink = {
      execute: (linkId) => {
        expireCalls.push(linkId);
        return Promise.resolve({ expired: 1, notified: 0 });
      },
    };
    const search: SearchIndexJobPublisher = {
      upsert: (input) => {
        searchUpserts.push(input.fingerprint);
        return Promise.resolve();
      },
      delete: () => Promise.resolve(),
    };
    const useCase = new CloseJobLinkUseCase(
      store,
      { now: () => NOW },
      {
        publish: (event) => {
          published.push(event);
          return Promise.resolve();
        },
      },
      expire,
      search,
    );

    const first = await useCase.execute({
      linkId: LINK_ID,
      reason: 'calendar',
    });
    expect(first.closed).toBe(true);
    expect(published).toHaveLength(1);
    expect(published[0].payload.linkId).toBe(LINK_ID);
    expect(expireCalls).toEqual([LINK_ID]);
    expect(searchUpserts[0]).toContain('closed');
  });

  it('skips search upsert when FEATURE_SEARCH publisher is absent', async () => {
    const store: FreshnessLinkStore = {
      listOpenEligible: () => Promise.resolve([]),
      listCascadePending: () => Promise.resolve([]),
      findById: (linkId) =>
        Promise.resolve({
          linkId,
          previewStatus: 'enriched',
          previewVersion: 2,
          preview: { title: 'X' },
          platform: 'getonboard',
          displayUrl: 'https://example.com/1',
          updatedAt: NOW,
        } satisfies FreshnessLinkRow),
      closeIfOpen: () => Promise.resolve(true),
      touchFreshnessCheck: () => Promise.resolve(),
    };
    const published: LinkEnrichedEvent[] = [];
    const expireCalls: string[] = [];
    const useCase = new CloseJobLinkUseCase(
      store,
      { now: () => NOW },
      {
        publish: (event) => {
          published.push(event);
          return Promise.resolve();
        },
      },
      {
        execute: (linkId) => {
          expireCalls.push(linkId);
          return Promise.resolve({ expired: 1, notified: 0 });
        },
      },
      null,
    );

    const result = await useCase.execute({
      linkId: LINK_ID,
      reason: 'recheck',
    });
    expect(result.closed).toBe(true);
    expect(published).toHaveLength(1);
    expect(expireCalls).toEqual([LINK_ID]);
  });
});
