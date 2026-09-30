import { describe, expect, it } from 'vitest';
import {
  FakeS3,
  s3Error,
  WRITE_COMMANDS,
} from '../../../test-support/fake-s3-send';
import { ObjectStoreReport } from './object-store-report';
import { verifyObjectStoreConfig } from './verify-config';

// `object-store verify`, parte de configuración, sobre un `send` falso (tarea 2.4 de `object-store`, design D4, spec
// `platform/object-store`: «Cualquier regla de ciclo de vida se detecta» y «El modo de comprobación no escribe»).

const BUCKETS = { cv: 'cvs', snapshots: 'snapshots' };
const NOW = new Date('2026-09-26T12:00:00Z');
const DAY_MS = 86_400_000;

/** Un almacén aprovisionado como se exige: sin reglas, con el bucket de CV cifrado y sin snapshots. */
function provisionedStore(): FakeS3 {
  return new FakeS3({
    GetBucketLifecycleConfiguration: () => {
      throw s3Error('NoSuchLifecycleConfiguration', 404);
    },
    GetBucketEncryption: () => ({
      ServerSideEncryptionConfiguration: {
        Rules: [
          { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    }),
    ListObjectsV2: () => ({ Contents: [], IsTruncated: false }),
  });
}

async function verify(
  store: FakeS3,
  encryptionMode: 'server' | 'customer-key' = 'server',
): Promise<ObjectStoreReport> {
  const report = new ObjectStoreReport();
  await verifyObjectStoreConfig(
    { send: store.send, buckets: BUCKETS, encryptionMode, now: () => NOW },
    report,
  );
  return report;
}

/** Lo que dejaba `ensure-buckets.sh`, y la regla que antes se habría exigido: habilitada, sin filtro y de 30 días. */
const THIRTY_DAY_RULE = {
  ID: 'expire-snapshots',
  Status: 'Enabled',
  Filter: {},
  Expiration: { Days: 30 },
};

describe('verifyObjectStoreConfig', () => {
  it('passes on a store provisioned as required', async () => {
    const store = provisionedStore();

    const report = await verify(store);

    expect(report.failures).toEqual([]);
    expect(report.render('verify')).toContain(
      'ok    cvs: default encryption (AES256)',
    );
    expect(report.render('verify')).toContain(
      'ok    snapshots: no snapshot older than 31 days (0 listed)',
    );
  });

  it('fails on ANY lifecycle rule in the snapshots bucket, even the 30-day enabled one, naming bucket and rule', async () => {
    const store = provisionedStore().on(
      'GetBucketLifecycleConfiguration',
      'snapshots',
      () => ({ Rules: [THIRTY_DAY_RULE] }),
    );

    const report = await verify(store);

    expect(report.passed).toBe(false);
    expect(report.failures).toEqual([
      'snapshots: lifecycle rule "expire-snapshots" (Enabled, expires after 30 days, no filter) is set; snapshot retention is the worker sweep, run provision to remove it',
    ]);
  });

  it('names every rule, with or without an id', async () => {
    const store = provisionedStore().on(
      'GetBucketLifecycleConfiguration',
      'snapshots',
      () => ({
        Rules: [
          { Status: 'Disabled', Prefix: 'old/', Expiration: { Days: 400 } },
          { ID: 'tmp', Status: 'Enabled', Filter: { Prefix: 'tmp/' } },
        ],
      }),
    );

    const report = await verify(store);

    expect(report.failures).toEqual([
      'snapshots: lifecycle rule #1 (Disabled, expires after 400 days, prefix "old/") is set; snapshot retention is the worker sweep, run provision to remove it',
      'snapshots: lifecycle rule "tmp" (Enabled, no expiration days, prefix "tmp/") is set; snapshot retention is the worker sweep, run provision to remove it',
    ]);
  });

  it('fails on a lifecycle rule in the CV bucket', async () => {
    const store = provisionedStore().on(
      'GetBucketLifecycleConfiguration',
      'cvs',
      () => ({
        Rules: [{ ID: 'purge', Status: 'Enabled', Expiration: { Days: 1 } }],
      }),
    );

    const report = await verify(store);

    expect(report.failures).toEqual([
      'cvs: lifecycle rule "purge" (Enabled, expires after 1 days, no filter) is set; snapshot retention is the worker sweep, run provision to remove it',
    ]);
  });

  it.each([
    ['NotImplemented', 501],
    ['UnknownError', 501],
  ])(
    'takes a lifecycle API answering %s (HTTP %i) as "no rule", noted',
    async (code, status) => {
      const store = provisionedStore().on(
        'GetBucketLifecycleConfiguration',
        undefined,
        () => {
          throw s3Error(code, status);
        },
      );

      const report = await verify(store);

      expect(report.passed).toBe(true);
      expect(report.lines.filter((line) => line.level === 'note')).toHaveLength(
        2,
      );
    },
  );

  it('fails when the CV bucket has no default encryption', async () => {
    const store = provisionedStore().on('GetBucketEncryption', 'cvs', () => {
      throw s3Error('ServerSideEncryptionConfigurationNotFoundError', 404);
    });

    const report = await verify(store);

    expect(report.failures).toEqual(['cvs: no default encryption']);
  });

  it('fails when the encryption configuration has no default algorithm', async () => {
    const store = provisionedStore().on('GetBucketEncryption', 'cvs', () => ({
      ServerSideEncryptionConfiguration: { Rules: [] },
    }));

    const report = await verify(store);

    expect(report.failures).toEqual(['cvs: no default encryption']);
  });

  it('does not check per-bucket encryption with the customer-key mode, and says so', async () => {
    const store = provisionedStore();

    const report = await verify(store, 'customer-key');

    expect(report.passed).toBe(true);
    expect(store.names()).not.toContain('GetBucketEncryption');
    expect(report.render('verify')).toContain(
      'note  cvs: customer-key encryption: not checkable per bucket',
    );
  });

  it('fails on a 32-day-old snapshot naming bucket and key, and passes a 30-day-old one', async () => {
    const store = provisionedStore().on('ListObjectsV2', 'snapshots', () => ({
      Contents: [
        {
          Key: 'link-a/1.html.gz',
          LastModified: new Date(NOW.getTime() - 32 * DAY_MS),
        },
        {
          Key: 'link-b/1.html.gz',
          LastModified: new Date(NOW.getTime() - 30 * DAY_MS),
        },
      ],
      IsTruncated: false,
    }));

    const report = await verify(store);

    expect(report.failures).toEqual([
      'snapshots: snapshot link-a/1.html.gz is 32 days old (more than 31); is the worker sweep running?',
    ]);
  });

  it('passes with only a 30-day-old snapshot', async () => {
    const store = provisionedStore().on('ListObjectsV2', 'snapshots', () => ({
      Contents: [
        {
          Key: 'link-b/1.html.gz',
          LastModified: new Date(NOW.getTime() - 30 * DAY_MS),
        },
      ],
    }));

    const report = await verify(store);

    expect(report.passed).toBe(true);
  });

  it('reads every page of the snapshot listing', async () => {
    const store = provisionedStore().on(
      'ListObjectsV2',
      'snapshots',
      (input) =>
        input['ContinuationToken'] === undefined
          ? {
              Contents: [{ Key: 'fresh/1.html.gz', LastModified: NOW }],
              IsTruncated: true,
              NextContinuationToken: 'page-2',
            }
          : {
              Contents: [
                {
                  Key: 'stale/1.html.gz',
                  LastModified: new Date(NOW.getTime() - 40 * DAY_MS),
                },
              ],
              IsTruncated: false,
            },
    );

    const report = await verify(store);

    expect(report.failures).toEqual([
      'snapshots: snapshot stale/1.html.gz is 40 days old (more than 31); is the worker sweep running?',
    ]);
  });

  it('fails naming a missing bucket and checks nothing else on it', async () => {
    const store = provisionedStore().on('HeadBucket', 'cvs', () => {
      throw s3Error('NotFound', 404);
    });

    const report = await verify(store);

    expect(report.failures).toEqual(['cvs: bucket missing']);
    expect(store.names('cvs')).toEqual(['HeadBucket']);
  });

  it('never sends a write command, whatever it finds', async () => {
    const clean = provisionedStore();
    const broken = provisionedStore()
      .on('GetBucketLifecycleConfiguration', undefined, () => ({
        Rules: [THIRTY_DAY_RULE],
      }))
      .on('GetBucketEncryption', 'cvs', () => {
        throw s3Error('ServerSideEncryptionConfigurationNotFoundError', 404);
      })
      .on('ListObjectsV2', 'snapshots', () => ({
        Contents: [{ Key: 'x/1.html.gz', LastModified: new Date(0) }],
      }));

    await verify(clean);
    await verify(broken);

    for (const store of [clean, broken]) {
      const sent = new Set(store.names());
      expect([...sent].sort()).toEqual([
        'GetBucketEncryption',
        'GetBucketLifecycleConfiguration',
        'HeadBucket',
        'ListObjectsV2',
      ]);
      for (const write of WRITE_COMMANDS) {
        expect(sent.has(write)).toBe(false);
      }
    }
  });
});
