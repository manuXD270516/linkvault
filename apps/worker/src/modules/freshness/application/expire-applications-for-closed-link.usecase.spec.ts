import { describe, expect, it } from 'vitest';
import { ExpireApplicationsForClosedLinkUseCase } from './expire-applications-for-closed-link.usecase';
import type {
  ClosedLinkApplicationRow,
  ClosedLinkApplications,
  FreshnessClock,
  FreshnessNotifyQueuePublisher,
  StatusGroupNotifyClaims,
} from './ports/freshness.ports';
import type { SearchIndexJobPublisher } from '../../search/application/ports/search-index-job-publisher.port';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const LINK = '507f1f77bcf86cd799439011';

function app(
  partial: Partial<ClosedLinkApplicationRow> & {
    readonly applicationId: string;
    readonly status: string;
  },
): ClosedLinkApplicationRow {
  return {
    userId: 'u-ana',
    linkId: LINK,
    visibility: 'private',
    statusChangedAt: NOW,
    version: 1,
    ...partial,
  };
}

class MemApps implements ClosedLinkApplications {
  rows: ClosedLinkApplicationRow[] = [];
  expireCalls: string[] = [];

  listForExpireCascade(): Promise<ClosedLinkApplicationRow[]> {
    return Promise.resolve(this.rows);
  }

  expireIfOpen(
    applicationId: string,
    now: Date,
  ): Promise<ClosedLinkApplicationRow | null> {
    this.expireCalls.push(applicationId);
    const current = this.rows.find((r) => r.applicationId === applicationId);
    if (current === undefined) return Promise.resolve(null);
    if (
      !['saved', 'interested', 'applied', 'in_process', 'offer'].includes(
        current.status,
      )
    ) {
      return Promise.resolve(null);
    }
    const next: ClosedLinkApplicationRow = {
      ...current,
      status: 'expired',
      statusChangedAt: now,
      version: current.version + 1,
    };
    this.rows = this.rows.map((r) =>
      r.applicationId === applicationId ? next : r,
    );
    return Promise.resolve(next);
  }
}

class MemClaims implements StatusGroupNotifyClaims {
  confirmedKeys = new Set<string>();
  released: string[] = [];
  failClaim = false;

  key(id: string, at: Date): string {
    return `${id}:${at.toISOString()}`;
  }

  claim(
    applicationId: string,
    statusChangedAt: Date,
  ): Promise<boolean> {
    if (this.failClaim) return Promise.resolve(false);
    const k = this.key(applicationId, statusChangedAt);
    if (this.confirmedKeys.has(k)) return Promise.resolve(false);
    return Promise.resolve(true);
  }
  release(applicationId: string, statusChangedAt: Date): Promise<void> {
    this.released.push(this.key(applicationId, statusChangedAt));
    return Promise.resolve();
  }
  confirm(applicationId: string, statusChangedAt: Date): Promise<void> {
    this.confirmedKeys.add(this.key(applicationId, statusChangedAt));
    return Promise.resolve();
  }
  isConfirmed(applicationId: string, statusChangedAt: Date): Promise<boolean> {
    return Promise.resolve(
      this.confirmedKeys.has(this.key(applicationId, statusChangedAt)),
    );
  }
}

class MemNotify implements FreshnessNotifyQueuePublisher {
  jobs: { name: string; jobId: string; data: Record<string, unknown> }[] = [];
  fail = false;

  add(job: {
    readonly name: string;
    readonly data: Record<string, unknown>;
    readonly jobId: string;
  }): Promise<void> {
    if (this.fail) return Promise.reject(new Error('queue down'));
    this.jobs.push({
      name: job.name,
      jobId: job.jobId,
      data: { ...job.data },
    });
    return Promise.resolve();
  }
}

class MemSearch implements SearchIndexJobPublisher {
  upserts: { aggregateId: string; fingerprint: string }[] = [];
  upsert(input: {
    readonly docType: string;
    readonly aggregateId: string;
    readonly reason: string;
    readonly fingerprint: string;
  }): Promise<void> {
    this.upserts.push({
      aggregateId: input.aggregateId,
      fingerprint: input.fingerprint,
    });
    return Promise.resolve();
  }
  delete(): Promise<void> {
    return Promise.resolve();
  }
}

class FixedClock implements FreshnessClock {
  now(): Date {
    return NOW;
  }
}

describe('ExpireApplicationsForClosedLink', () => {
  it('expires Ana and Luis, leaves Marta rejected and accepted untouched', async () => {
    const apps = new MemApps();
    apps.rows = [
      app({ applicationId: 'ana', status: 'applied', userId: 'u-ana' }),
      app({
        applicationId: 'luis',
        status: 'interested',
        userId: 'u-luis',
      }),
      app({
        applicationId: 'marta',
        status: 'rejected',
        userId: 'u-marta',
      }),
      app({
        applicationId: 'hired',
        status: 'accepted',
        userId: 'u-hired',
      }),
    ];
    const useCase = new ExpireApplicationsForClosedLinkUseCase(
      apps,
      new MemClaims(),
      new MemNotify(),
      new FixedClock(),
      null,
    );

    const result = await useCase.execute(LINK);
    expect(result.expired).toBe(2);
    expect(apps.expireCalls).toEqual(['ana', 'luis']);
    expect(apps.rows.find((r) => r.applicationId === 'marta')?.status).toBe(
      'rejected',
    );
    expect(apps.rows.find((r) => r.applicationId === 'hired')?.status).toBe(
      'accepted',
    );
  });

  it('enqueues ASN with actorUserId=owner for group visibility without outbox', async () => {
    const apps = new MemApps();
    apps.rows = [
      app({
        applicationId: 'ana',
        status: 'in_process',
        visibility: 'group',
        userId: 'u-ana',
      }),
    ];
    const notify = new MemNotify();
    const claims = new MemClaims();
    const useCase = new ExpireApplicationsForClosedLinkUseCase(
      apps,
      claims,
      notify,
      new FixedClock(),
      null,
    );

    const result = await useCase.execute(LINK);
    expect(result.expired).toBe(1);
    expect(result.notified).toBe(1);
    expect(notify.jobs).toHaveLength(1);
    expect(notify.jobs[0].name).toBe('ApplicationStatusNotify.v1');
    expect(notify.jobs[0].data['actorUserId']).toBe('u-ana');
    expect(notify.jobs[0].jobId.split(':')).toHaveLength(3);
    expect(claims.confirmedKeys.size).toBe(1);
  });

  it('releases claim when Queue.add fails so a later pass can re-enqueue', async () => {
    const apps = new MemApps();
    apps.rows = [
      app({
        applicationId: 'ana',
        status: 'expired',
        visibility: 'group',
        userId: 'u-ana',
      }),
    ];
    const notify = new MemNotify();
    notify.fail = true;
    const claims = new MemClaims();
    const useCase = new ExpireApplicationsForClosedLinkUseCase(
      apps,
      claims,
      notify,
      new FixedClock(),
      null,
    );

    const result = await useCase.execute(LINK);
    expect(result.notified).toBe(0);
    expect(claims.released).toHaveLength(1);
    expect(claims.confirmedKeys.size).toBe(0);

    notify.fail = false;
    const retry = await useCase.execute(LINK);
    expect(retry.notified).toBe(1);
  });

  it('does not double-notify when claim is already confirmed', async () => {
    const apps = new MemApps();
    const statusChangedAt = NOW;
    apps.rows = [
      app({
        applicationId: 'ana',
        status: 'expired',
        visibility: 'group',
        statusChangedAt,
      }),
    ];
    const claims = new MemClaims();
    claims.confirmedKeys.add(`ana:${statusChangedAt.toISOString()}`);
    const notify = new MemNotify();
    const useCase = new ExpireApplicationsForClosedLinkUseCase(
      apps,
      claims,
      notify,
      new FixedClock(),
      null,
    );

    await useCase.execute(LINK);
    expect(notify.jobs).toHaveLength(0);
  });

  it('upserts application search when FEATURE_SEARCH publisher is present', async () => {
    const apps = new MemApps();
    apps.rows = [app({ applicationId: 'ana', status: 'applied' })];
    const search = new MemSearch();
    const useCase = new ExpireApplicationsForClosedLinkUseCase(
      apps,
      new MemClaims(),
      new MemNotify(),
      new FixedClock(),
      search,
    );

    await useCase.execute(LINK);
    expect(search.upserts).toHaveLength(1);
    expect(search.upserts[0].aggregateId).toBe('ana');
    expect(search.upserts[0].fingerprint).toContain('expired');
  });
});
