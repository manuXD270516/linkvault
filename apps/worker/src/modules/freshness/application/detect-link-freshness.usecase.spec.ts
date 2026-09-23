import { describe, expect, it } from 'vitest';
import {
  DetectLinkFreshness,
  FRESHNESS_CLAIM_LEASE_MS,
} from './detect-link-freshness.usecase';
import type {
  CloseJobLink,
  EnrichLinkQueuePublisher,
  ExpireApplicationsForClosedLink,
  FreshnessClock,
  FreshnessLinkClaims,
  FreshnessLinkRow,
  FreshnessLinkStore,
} from './ports/freshness.ports';

const NOW = new Date('2026-09-22T12:00:00.000Z');

function row(
  partial: Partial<FreshnessLinkRow> & { readonly linkId: string },
): FreshnessLinkRow {
  return {
    previewStatus: 'enriched',
    previewVersion: 2,
    preview: {},
    platform: 'getonboard',
    displayUrl: 'https://www.getonbrd.com/jobs/1',
    updatedAt: NOW,
    ...partial,
  };
}

class MemStore implements FreshnessLinkStore {
  open: FreshnessLinkRow[] = [];
  cascade: FreshnessLinkRow[] = [];
  byId = new Map<string, FreshnessLinkRow>();
  closed: { linkId: string; reason: string }[] = [];
  touched: string[] = [];

  listOpenEligible(): Promise<FreshnessLinkRow[]> {
    return Promise.resolve(this.open);
  }
  listCascadePending(): Promise<FreshnessLinkRow[]> {
    return Promise.resolve(this.cascade);
  }
  findById(linkId: string): Promise<FreshnessLinkRow | null> {
    return Promise.resolve(this.byId.get(linkId) ?? null);
  }
  closeIfOpen(
    linkId: string,
    write: {
      readonly closedAt: Date;
      readonly closedReason: 'calendar' | 'recheck';
      readonly lastFreshnessCheckAt: Date;
    },
  ): Promise<boolean> {
    this.closed.push({ linkId, reason: write.closedReason });
    return Promise.resolve(true);
  }
  touchFreshnessCheck(linkId: string): Promise<void> {
    this.touched.push(linkId);
    return Promise.resolve();
  }
}

class MemClaims implements FreshnessLinkClaims {
  claimed: string[] = [];
  released: string[] = [];
  confirmed: string[] = [];
  refuse = new Set<string>();

  claim(linkId: string): Promise<boolean> {
    if (this.refuse.has(linkId)) return Promise.resolve(false);
    this.claimed.push(linkId);
    return Promise.resolve(true);
  }
  release(linkId: string): Promise<void> {
    this.released.push(linkId);
    return Promise.resolve();
  }
  confirm(linkId: string): Promise<void> {
    this.confirmed.push(linkId);
    return Promise.resolve();
  }
}

class MemEnrichQueue implements EnrichLinkQueuePublisher {
  jobs: {
    jobId: string;
    data: {
      linkId: string;
      previewVersion: number;
      triggeredBy: 'freshness';
    };
  }[] = [];

  add(job: {
    readonly data: {
      readonly linkId: string;
      readonly previewVersion: number;
      readonly triggeredBy: 'freshness';
    };
    readonly jobId: string;
  }): Promise<void> {
    this.jobs.push({ jobId: job.jobId, data: { ...job.data } });
    return Promise.resolve();
  }
}

class MemClose implements CloseJobLink {
  calls: { linkId: string; reason: string }[] = [];
  execute(input: {
    readonly linkId: string;
    readonly reason: 'calendar' | 'recheck';
  }): Promise<{ readonly closed: boolean; readonly alreadyClosed: boolean }> {
    this.calls.push(input);
    return Promise.resolve({ closed: true, alreadyClosed: false });
  }
}

class MemExpire implements ExpireApplicationsForClosedLink {
  calls: string[] = [];
  execute(
    linkId: string,
  ): Promise<{ readonly expired: number; readonly notified: number }> {
    this.calls.push(linkId);
    return Promise.resolve({ expired: 1, notified: 0 });
  }
}

class FixedClock implements FreshnessClock {
  constructor(private readonly current: Date) {}
  now(): Date {
    return this.current;
  }
}

function detector(
  store: MemStore,
  extras: {
    claims?: MemClaims;
    enrich?: MemEnrichQueue;
    close?: MemClose;
    expire?: MemExpire;
    enabled?: boolean;
    batchLimit?: number;
  } = {},
): {
  useCase: DetectLinkFreshness;
  claims: MemClaims;
  enrich: MemEnrichQueue;
  close: MemClose;
  expire: MemExpire;
} {
  const claims = extras.claims ?? new MemClaims();
  const enrich = extras.enrich ?? new MemEnrichQueue();
  const close = extras.close ?? new MemClose();
  const expire = extras.expire ?? new MemExpire();
  return {
    useCase: new DetectLinkFreshness(
      {
        enabled: extras.enabled ?? true,
        intervalDays: 7,
        batchLimit: extras.batchLimit ?? 50,
      },
      store,
      claims,
      enrich,
      close,
      expire,
      new FixedClock(NOW),
    ),
    claims,
    enrich,
    close,
    expire,
  };
}

describe('DetectLinkFreshness', () => {
  it('is a no-op when the feature flag is off', async () => {
    const store = new MemStore();
    store.open = [row({ linkId: 'l1' })];
    const { useCase, enrich, close } = detector(store, { enabled: false });

    await expect(useCase.execute()).resolves.toEqual({
      cascade: 0,
      calendar: 0,
      enqueued: 0,
      deferred: 0,
    });
    expect(enrich.jobs).toHaveLength(0);
    expect(close.calls).toHaveLength(0);
  });

  it('prioritizes cascade within the batch limit before open links', async () => {
    const store = new MemStore();
    store.cascade = [
      row({
        linkId: 'c1',
        closedAt: NOW,
        closedReason: 'calendar',
      }),
      row({
        linkId: 'c2',
        closedAt: NOW,
        closedReason: 'recheck',
      }),
    ];
    store.open = [
      row({
        linkId: 'o1',
        preview: { expiresAt: '2026-01-01' },
      }),
    ];
    const { useCase, expire, close } = detector(store, { batchLimit: 2 });

    const result = await useCase.execute();
    expect(result.cascade).toBe(2);
    expect(result.calendar).toBe(0);
    expect(expire.calls).toEqual(['c1', 'c2']);
    expect(close.calls).toHaveLength(0);
  });

  it('claims at most BATCH_LIMIT of 200 eligible links and prefers cascade', async () => {
    const store = new MemStore();
    const batchLimit = 50;
    store.cascade = Array.from({ length: 30 }, (_, i) =>
      row({
        linkId: `c${i}`,
        closedAt: NOW,
        closedReason: 'calendar',
      }),
    );
    store.open = Array.from({ length: 170 }, (_, i) =>
      row({
        linkId: `o${i}`,
        preview: { expiresAt: '2026-01-01' },
        lastFreshnessCheckAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    );
    const { useCase, claims, expire, close } = detector(store, { batchLimit });

    const result = await useCase.execute();
    expect(result.cascade).toBe(30);
    expect(result.calendar).toBe(20);
    expect(claims.claimed).toHaveLength(batchLimit);
    expect(expire.calls).toHaveLength(30);
    expect(close.calls).toHaveLength(20);
    expect(close.calls.every((c) => c.linkId.startsWith('o'))).toBe(true);
  });

  it('closes by calendar without enqueueing scrape when expiresAt is past', async () => {
    const store = new MemStore();
    store.open = [
      row({
        linkId: 'l1',
        preview: { expiresAt: '2026-01-01' },
        lastFreshnessCheckAt: new Date('2026-09-21T00:00:00.000Z'),
      }),
    ];
    const { useCase, close, enrich } = detector(store);

    const result = await useCase.execute();
    expect(result.calendar).toBe(1);
    expect(close.calls).toEqual([{ linkId: 'l1', reason: 'calendar' }]);
    expect(enrich.jobs).toHaveLength(0);
  });

  it('defers non-scrapeable platforms without closing', async () => {
    const store = new MemStore();
    store.open = [
      row({
        linkId: 'li',
        platform: 'linkedin',
        lastFreshnessCheckAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ];
    const { useCase, enrich, close } = detector(store);

    const result = await useCase.execute();
    expect(result.deferred).toBe(1);
    expect(store.touched).toEqual(['li']);
    expect(enrich.jobs).toHaveLength(0);
    expect(close.calls).toHaveLength(0);
  });

  it('enqueues fresh:{linkId}:{bucket} with triggeredBy freshness', async () => {
    const store = new MemStore();
    store.open = [
      row({
        linkId: '507f1f77bcf86cd799439011',
        lastFreshnessCheckAt: new Date('2026-09-01T00:00:00.000Z'),
        previewVersion: 3,
      }),
    ];
    const { useCase, enrich } = detector(store);

    const result = await useCase.execute();
    expect(result.enqueued).toBe(1);
    expect(enrich.jobs).toHaveLength(1);
    const job = enrich.jobs[0];
    expect(job.jobId.split(':')).toHaveLength(3);
    expect(job.jobId.startsWith('fresh:507f1f77bcf86cd799439011:')).toBe(true);
    expect(job.data).toEqual({
      linkId: '507f1f77bcf86cd799439011',
      previewVersion: 3,
      triggeredBy: 'freshness',
    });
  });

  it('releases the claim when work fails so the link stays eligible', async () => {
    const store = new MemStore();
    store.open = [
      row({
        linkId: 'l1',
        preview: { expiresAt: '2026-01-01' },
      }),
    ];
    const close: CloseJobLink = {
      execute: () => Promise.reject(new Error('boom')),
    };
    const claims = new MemClaims();
    const { useCase } = detector(store, { claims, close: close as MemClose });

    await useCase.execute();
    expect(claims.claimed).toEqual(['l1']);
    expect(claims.released).toEqual(['l1']);
    expect(claims.confirmed).toHaveLength(0);
    expect(FRESHNESS_CLAIM_LEASE_MS).toBeGreaterThan(0);
  });
});
