import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeS3, s3Error } from '../../../test-support/fake-s3-send';
import { PROVISION_DEADLINE_MS, provisionObjectStore } from './provision';

// `object-store provision` sobre un `send` falso (tarea 2.3 de `object-store`, design D4, spec `platform/object-store`
// «Aprovisionamiento idempotente y separado de la salud»).

const BUCKETS = { cv: 'cvs', snapshots: 'snapshots' };

function provision(
  store: FakeS3,
  encryptionMode: 'server' | 'customer-key' = 'server',
) {
  return provisionObjectStore({
    send: store.send,
    buckets: BUCKETS,
    encryptionMode,
  });
}

describe('provisionObjectStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates both buckets, encrypts the CV one and leaves no lifecycle rule nor policy', async () => {
    const store = new FakeS3();

    const report = await provision(store);

    expect(report.passed).toBe(true);
    expect(store.names('cvs')).toEqual([
      'CreateBucket',
      'DeleteBucketLifecycle',
      'PutBucketEncryption',
      'GetBucketPolicy',
    ]);
    expect(store.names('snapshots')).toEqual([
      'CreateBucket',
      'DeleteBucketLifecycle',
      'GetBucketPolicy',
    ]);
    const encryption = store.sent.find((c) => c.name === 'PutBucketEncryption');
    expect(encryption?.input).toMatchObject({
      Bucket: 'cvs',
      ServerSideEncryptionConfiguration: {
        Rules: [
          { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    });
  });

  it('removes the lifecycle configuration of the snapshots bucket and never puts one', async () => {
    const store = new FakeS3();

    await provision(store);

    expect(store.names('snapshots')).toContain('DeleteBucketLifecycle');
    expect(store.names('cvs')).toContain('DeleteBucketLifecycle');
    expect(store.names()).not.toContain('PutBucketLifecycleConfiguration');
  });

  it('takes a bucket that already exists as a success', async () => {
    const store = new FakeS3().on('CreateBucket', undefined, () => {
      throw s3Error('BucketAlreadyOwnedByYou', 409);
    });

    const report = await provision(store);

    expect(report.passed).toBe(true);
    expect(report.render('provision')).toContain('cvs: bucket already exists');
    expect(report.render('provision')).toContain(
      'snapshots: bucket already exists',
    );
  });

  it('is idempotent: a second run sends the same commands and passes again', async () => {
    const store = new FakeS3();
    await provision(store);
    const first = store.names();
    store.sent.length = 0;
    store.on('CreateBucket', undefined, () => {
      throw s3Error('BucketAlreadyOwnedByYou', 409);
    });

    const report = await provision(store);

    expect(report.passed).toBe(true);
    expect(store.names()).toEqual(first);
  });

  it('takes NoSuchLifecycleConfiguration as "no rule"', async () => {
    const store = new FakeS3().on('DeleteBucketLifecycle', undefined, () => {
      throw s3Error('NoSuchLifecycleConfiguration', 404);
    });

    const report = await provision(store);

    expect(report.passed).toBe(true);
    expect(report.render('provision')).toContain(
      'snapshots: no lifecycle configuration',
    );
  });

  it.each([
    ['NotImplemented', 501],
    ['UnknownError', 501],
  ])(
    'takes a lifecycle API answering %s (HTTP %i) as a success noted in the output',
    async (code, status) => {
      const store = new FakeS3().on('DeleteBucketLifecycle', undefined, () => {
        throw s3Error(code, status);
      });

      const report = await provision(store);

      expect(report.passed).toBe(true);
      const notes = report.lines.filter((line) => line.level === 'note');
      expect(notes.map((line) => line.text)).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^snapshots: the store does not implement lifecycle configuration/,
          ),
        ]),
      );
    },
  );

  it.each([
    ['GetBucketPolicy', 'NotImplemented', 501],
    ['GetBucketPolicy', 'UnknownError', 501],
    ['DeleteBucketPolicy', 'NotImplemented', 501],
    ['DeleteBucketPolicy', 'UnknownError', 501],
  ] as const)(
    'takes %s answering %s (HTTP %i) as a store without bucket policies, noted',
    async (command, code, status) => {
      const store = new FakeS3()
        .on('GetBucketPolicy', undefined, () => ({
          Policy: '{"Statement":[]}',
        }))
        .on(command, undefined, () => {
          throw s3Error(code, status);
        });

      const report = await provision(store);

      expect(report.passed).toBe(true);
      const output = report.render('provision');
      expect(output).toContain('cvs: the store has no bucket policies');
      expect(output).toContain('snapshots: the store has no bucket policies');
    },
  );

  it('removes a bucket policy that is there', async () => {
    const store = new FakeS3().on('GetBucketPolicy', 'cvs', () => ({
      Policy: '{"Statement":[{"Effect":"Allow","Principal":"*"}]}',
    }));

    const report = await provision(store);

    expect(report.passed).toBe(true);
    expect(store.names('cvs')).toContain('DeleteBucketPolicy');
    expect(store.names('snapshots')).not.toContain('DeleteBucketPolicy');
  });

  it('keeps preparing the other bucket when one fails, and names the failed one', async () => {
    const store = new FakeS3().on('CreateBucket', 'cvs', () => {
      throw s3Error('AccessDenied', 403);
    });

    const report = await provision(store);

    expect(report.passed).toBe(false);
    expect(report.failures).toEqual([
      'cvs: create bucket: AccessDenied (HTTP 403)',
    ]);
    expect(store.names('snapshots')).toEqual([
      'CreateBucket',
      'DeleteBucketLifecycle',
      'GetBucketPolicy',
    ]);
    expect(report.render('provision')).toMatch(
      /provision: FAILED \(1\): cvs: create bucket: AccessDenied \(HTTP 403\)\n$/,
    );
  });

  it('prepares the CV bucket even when the snapshots one fails', async () => {
    const store = new FakeS3().on('CreateBucket', 'snapshots', () => {
      throw s3Error('InternalError', 500);
    });

    const report = await provision(store);

    expect(report.failures).toEqual([
      'snapshots: create bucket: InternalError (HTTP 500)',
    ]);
    expect(store.names('cvs')).toContain('PutBucketEncryption');
  });

  it('names bucket and property when the default encryption cannot be set', async () => {
    const store = new FakeS3().on('PutBucketEncryption', 'cvs', () => {
      throw s3Error('NotImplemented', 501);
    });

    const report = await provision(store);

    expect(report.failures).toEqual([
      'cvs: default encryption: NotImplemented (HTTP 501)',
    ]);
  });

  it('does not set per-bucket encryption with the customer-key mode, and says so', async () => {
    const store = new FakeS3();

    const report = await provision(store, 'customer-key');

    expect(report.passed).toBe(true);
    expect(store.names()).not.toContain('PutBucketEncryption');
    expect(report.render('provision')).toContain(
      'cvs: customer-key encryption',
    );
  });

  it('ends at the 90 s global deadline naming the step in progress when the store never answers', async () => {
    vi.useFakeTimers();
    const store = new FakeS3().on(
      'CreateBucket',
      undefined,
      () => new Promise<never>(() => undefined),
    );

    const running = provision(store);
    let settled = false;
    void running.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(PROVISION_DEADLINE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const report = await running;

    expect(PROVISION_DEADLINE_MS).toBe(90_000);
    expect(report.passed).toBe(false);
    expect(report.failures).toEqual([
      'deadline of 90 s exceeded during "cvs: create bucket"',
    ]);
  });

  it('aborts the request in progress when the deadline expires', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const store = new FakeS3().on(
      'DeleteBucketLifecycle',
      'snapshots',
      (_input, options) => {
        signal = options?.abortSignal;
        return new Promise<never>(() => undefined);
      },
    );

    const running = provision(store);
    await vi.advanceTimersByTimeAsync(PROVISION_DEADLINE_MS);
    const report = await running;

    expect(report.failures).toEqual([
      'deadline of 90 s exceeded during "snapshots: lifecycle configuration"',
    ]);
    expect(signal?.aborted).toBe(true);
  });
});
