import { beforeEach, describe, expect, it } from 'vitest';
import {
  DetectStaleApplications,
  STALE_CLAIM_LEASE_MS,
} from './detect-stale-applications.usecase';
import type {
  ApplicationStaleClaims,
  NotifyFanoutQueuePublisher,
  StaleApplicationRow,
} from './ports/notify.ports';

const NOW = new Date('2026-09-22T12:00:00.000Z');
const TEN_DAYS_AGO = new Date('2026-09-12T12:00:00.000Z');

class MemClaims implements ApplicationStaleClaims {
  rows: StaleApplicationRow[] = [];
  claimed = new Map<string, { at: Date; confirmed: boolean }>();
  released: string[] = [];

  listEligible(): Promise<StaleApplicationRow[]> {
    return Promise.resolve(this.rows);
  }

  claim(
    applicationId: string,
    statusChangedAt: Date,
  ): Promise<boolean> {
    const key = `${applicationId}:${statusChangedAt.toISOString()}`;
    if (this.claimed.has(key) && this.claimed.get(key)!.confirmed) {
      return Promise.resolve(false);
    }
    this.claimed.set(key, { at: NOW, confirmed: false });
    return Promise.resolve(true);
  }

  release(applicationId: string, statusChangedAt: Date): Promise<void> {
    const key = `${applicationId}:${statusChangedAt.toISOString()}`;
    this.claimed.delete(key);
    this.released.push(key);
    return Promise.resolve();
  }

  confirm(applicationId: string, statusChangedAt: Date): Promise<void> {
    const key = `${applicationId}:${statusChangedAt.toISOString()}`;
    const current = this.claimed.get(key);
    if (current) {
      this.claimed.set(key, { ...current, confirmed: true });
    }
    return Promise.resolve();
  }
}

class MemQueue implements NotifyFanoutQueuePublisher {
  jobs: { jobId: string; data: Record<string, unknown> }[] = [];
  fail = false;
  add(job: {
    name: string;
    data: Record<string, unknown>;
    jobId: string;
  }): Promise<void> {
    if (this.fail) {
      return Promise.reject(new Error('redis down'));
    }
    this.jobs.push({ jobId: job.jobId, data: job.data });
    return Promise.resolve();
  }
}

describe('DetectStaleApplications', () => {
  let claims: MemClaims;
  let queue: MemQueue;
  let detector: DetectStaleApplications;

  beforeEach(() => {
    claims = new MemClaims();
    queue = new MemQueue();
    detector = new DetectStaleApplications(claims, queue, {
      now: () => NOW,
    });
  });

  it('encola aviso al dueño tras claim', async () => {
    claims.rows = [
      {
        applicationId: 'a1',
        userId: 'u1',
        linkId: 'l1',
        status: 'applied',
        statusChangedAt: TEN_DAYS_AGO,
      },
    ];
    const n = await detector.execute();
    expect(n).toBe(1);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.data).toMatchObject({
      applicationId: 'a1',
      userId: 'u1',
    });
    expect(STALE_CLAIM_LEASE_MS).toBeGreaterThan(0);
  });

  it('no encola cerradas', async () => {
    claims.rows = [
      {
        applicationId: 'a1',
        userId: 'u1',
        linkId: 'l1',
        status: 'rejected',
        statusChangedAt: TEN_DAYS_AGO,
      },
    ];
    expect(await detector.execute()).toBe(0);
    expect(queue.jobs).toHaveLength(0);
  });

  it('libera claim si Queue.add falla', async () => {
    claims.rows = [
      {
        applicationId: 'a1',
        userId: 'u1',
        linkId: 'l1',
        status: 'applied',
        statusChangedAt: TEN_DAYS_AGO,
      },
    ];
    queue.fail = true;
    expect(await detector.execute()).toBe(0);
    expect(claims.released).toHaveLength(1);
  });

  it('segunda pasada no reemite tras confirm', async () => {
    claims.rows = [
      {
        applicationId: 'a1',
        userId: 'u1',
        linkId: 'l1',
        status: 'applied',
        statusChangedAt: TEN_DAYS_AGO,
      },
    ];
    expect(await detector.execute()).toBe(1);
    expect(await detector.execute()).toBe(0);
    expect(queue.jobs).toHaveLength(1);
  });
});
