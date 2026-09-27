import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clock } from './ports/clock.port';
import type { SnapshotListPage } from './ports/snapshot-bucket.port';
import { SweepExpiredSnapshots } from './sweep-expired-snapshots.usecase';
import { InMemorySnapshotBucket } from './testing/in-memory-snapshot-bucket';

// Spec `cv/documents`, «Retención de snapshots de enriquecimiento», y design D7 de `object-store`: el barrido diario del
// `worker` borra los snapshots de más de 30 días, solo en el bucket de snapshots, y dos réplicas a la vez no fallan.

const SNAPSHOTS = 'linkvault-snapshots';
const CV = 'linkvault-cv';
const NOW = new Date('2026-09-26T03:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function clockAt(date: Date): Clock {
  return { now: () => date };
}

/** Snapshots a ambos lados del plazo: tres de más de 30 días y tres de 30 o menos. */
function seed(store: InMemorySnapshotBucket, bucket = SNAPSHOTS): void {
  store.put(bucket, 'a/1.html.gz', ago(45 * DAY_MS));
  store.put(bucket, 'b/1.html.gz', ago(31 * DAY_MS));
  store.put(bucket, 'c/1.html.gz', ago(30 * DAY_MS + 1));
  store.put(bucket, 'd/1.html.gz', ago(30 * DAY_MS));
  store.put(bucket, 'e/1.html.gz', ago(29 * DAY_MS));
  store.put(bucket, 'f/1.html.gz', ago(60 * 60 * 1000));
}

const RECENT = ['d/1.html.gz', 'e/1.html.gz', 'f/1.html.gz'];

let error: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  error = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SweepExpiredSnapshots', () => {
  it('deletes only the snapshots older than 30 days, across pages, and leaves the CV bucket alone', async () => {
    const store = new InMemorySnapshotBucket(2);
    seed(store);
    store.put(CV, 'user-1/cv.pdf', ago(400 * DAY_MS));
    const sweep = new SweepExpiredSnapshots(store, clockAt(NOW), {
      snapshotsBucket: SNAPSHOTS,
      cvBucket: CV,
    });

    const result = await sweep.execute();

    expect(result).toEqual({
      status: 'swept',
      listed: 6,
      expired: 3,
      deleted: 3,
      alreadyGone: 0,
      failed: 0,
    });
    expect(store.keys(SNAPSHOTS)).toEqual(RECENT);
    expect(store.keys(CV)).toEqual(['user-1/cv.pdf']);
    expect(store.deleteCalls.every((call) => call.bucket === SNAPSHOTS)).toBe(
      true,
    );
    expect(log).toHaveBeenCalledWith(
      'snapshot sweep: listed 6, expired 3, deleted 3, already gone 0, failed 0',
    );
  });

  it('reads the age from the injected clock: 31 days later, today’s snapshot goes', async () => {
    const store = new InMemorySnapshotBucket();
    store.put(SNAPSHOTS, 'g/1.html.gz', NOW);
    const buckets = { snapshotsBucket: SNAPSHOTS, cvBucket: CV };

    await new SweepExpiredSnapshots(store, clockAt(NOW), buckets).execute();
    expect(store.keys(SNAPSHOTS)).toEqual(['g/1.html.gz']);

    await new SweepExpiredSnapshots(
      store,
      clockAt(new Date(NOW.getTime() + 31 * DAY_MS)),
      buckets,
    ).execute();
    expect(store.keys(SNAPSHOTS)).toEqual([]);
  });

  it('refuses to run when the snapshots bucket is the CV bucket, deletes nothing and logs why', async () => {
    const store = new InMemorySnapshotBucket();
    seed(store, CV);
    const sweep = new SweepExpiredSnapshots(store, clockAt(NOW), {
      snapshotsBucket: CV,
      cvBucket: CV,
    });

    const result = await sweep.execute();

    expect(result).toEqual({
      status: 'refused',
      reason: 'snapshots-bucket-is-cv-bucket',
    });
    expect(store.keys(CV)).toHaveLength(6);
    expect(store.deleteCalls).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toContain('S3_SNAPSHOTS_BUCKET');
    expect(message).toContain('S3_BUCKET');
    expect(message).toContain('refused');
    // Ni el nombre del bucket ni ninguna clave: el registro dice por qué, no qué hay dentro.
    expect(message).not.toContain(CV);
    expect(message).not.toContain('.html.gz');
  });

  it('treats an object another replica already deleted as success', async () => {
    const store = new InMemorySnapshotBucket(10);
    seed(store);
    // Otra réplica borra lo viejo justo después de que este barrido lo liste.
    const racing = {
      listPage: async (
        bucket: string,
        token: string | null,
      ): Promise<SnapshotListPage> => {
        const page = await store.listPage(bucket, token);
        await store.deleteMany(bucket, ['a/1.html.gz', 'b/1.html.gz']);
        return page;
      },
      deleteMany: store.deleteMany.bind(store),
    };
    const sweep = new SweepExpiredSnapshots(racing, clockAt(NOW), {
      snapshotsBucket: SNAPSHOTS,
      cvBucket: CV,
    });

    const result = await sweep.execute();

    expect(result).toEqual({
      status: 'swept',
      listed: 6,
      expired: 3,
      deleted: 1,
      alreadyGone: 2,
      failed: 0,
    });
    expect(store.keys(SNAPSHOTS)).toEqual(RECENT);
    expect(warn).not.toHaveBeenCalled();
  });

  it('lets two sweeps run at the same time without failing or touching recent snapshots', async () => {
    const store = new InMemorySnapshotBucket(2);
    seed(store);
    const buckets = { snapshotsBucket: SNAPSHOTS, cvBucket: CV };
    const first = new SweepExpiredSnapshots(store, clockAt(NOW), buckets);
    const second = new SweepExpiredSnapshots(store, clockAt(NOW), buckets);

    const results = await Promise.all([first.execute(), second.execute()]);

    expect(store.keys(SNAPSHOTS)).toEqual(RECENT);
    let deleted = 0;
    let alreadyGone = 0;
    for (const result of results) {
      expect(result.status).toBe('swept');
      if (result.status === 'swept') {
        expect(result.failed).toBe(0);
        deleted += result.deleted;
        alreadyGone += result.alreadyGone;
      }
    }
    // Entre los dos, cada snapshot viejo se borró una vez; el otro lo encontró ya borrado.
    expect(deleted).toBe(3);
    expect(alreadyGone).toBe(3);
  });

  it('counts a delete the store rejects, keeps going and warns with the code only', async () => {
    const store = new InMemorySnapshotBucket();
    seed(store);
    store.failingKeys.set('a/1.html.gz', 'AccessDenied');
    const sweep = new SweepExpiredSnapshots(store, clockAt(NOW), {
      snapshotsBucket: SNAPSHOTS,
      cvBucket: CV,
    });

    const result = await sweep.execute();

    expect(result).toEqual({
      status: 'swept',
      listed: 6,
      expired: 3,
      deleted: 2,
      alreadyGone: 0,
      failed: 1,
    });
    expect(store.keys(SNAPSHOTS)).toEqual(['a/1.html.gz', ...RECENT]);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('AccessDenied');
    expect(message).not.toContain('.html.gz');
  });
});
