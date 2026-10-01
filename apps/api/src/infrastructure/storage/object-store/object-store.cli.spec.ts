import { describe, expect, it } from 'vitest';
import {
  FakeS3,
  s3Error,
  WRITE_COMMANDS,
} from '../../../test-support/fake-s3-send';
import { runObjectStoreCli } from './object-store.cli';
import type { AnonymousResponse } from './verify-anonymous';

// La orden `object-store` (design D4 de `object-store`): uso, configuración (solo las `S3_*`, nombradas y sin valores)
// y código de salida según lo que informa cada subcomando.

const ENV = {
  S3_ENDPOINT: 'http://127.0.0.1:9',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'cli-test-access',
  S3_SECRET_KEY: 'cli-test-secret-value',
  S3_BUCKET: 'cvs',
  S3_SNAPSHOTS_BUCKET: 'snapshots',
};

const REJECTED: AnonymousResponse = {
  status: 403,
  body: Buffer.from('<Error><Code>AccessDenied</Code></Error>'),
};

function harness(
  store = new FakeS3(),
  anonymous: (url: string, method: string) => AnonymousResponse = () =>
    REJECTED,
) {
  const out: string[] = [];
  const err: string[] = [];
  const urls: string[] = [];
  let closed = 0;
  return {
    out,
    err,
    store,
    urls,
    closed: () => closed,
    run: (
      argv: readonly string[],
      env: Record<string, string | undefined> = ENV,
    ) =>
      runObjectStoreCli(argv, {
        env,
        io: { out: (text) => out.push(text), err: (text) => err.push(text) },
        connect: () => ({
          send: store.send,
          close: () => {
            closed += 1;
          },
        }),
        fetch: (url, request) => {
          urls.push(`${request.method} ${url}`);
          return Promise.resolve(anonymous(url, request.method));
        },
      }),
  };
}

/** Un almacén aprovisionado como se exige, visto por las lecturas firmadas de `verify`. */
function provisionedStore(): FakeS3 {
  return new FakeS3({
    GetBucketEncryption: () => ({
      ServerSideEncryptionConfiguration: {
        Rules: [
          { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
        ],
      },
    }),
  });
}

describe('runObjectStoreCli', () => {
  it.each([[[]], [['list']], [['provision', 'extra']]])(
    'exits 2 with the usage for %j',
    async (argv) => {
      const h = harness();

      await expect(h.run(argv)).resolves.toBe(2);
      expect(h.err.join('')).toContain(
        'usage: object-store <provision|verify>',
      );
      expect(h.store.sent).toEqual([]);
    },
  );

  it('exits 2 naming the missing S3_* variables, before talking to the store', async () => {
    const h = harness();

    const code = await h.run(['verify'], {
      S3_REGION: 'us-east-1',
      S3_SECRET_KEY: 'cli-test-secret-value',
    });

    expect(code).toBe(2);
    const message = h.err.join('');
    for (const name of [
      'S3_ENDPOINT',
      'S3_ACCESS_KEY',
      'S3_BUCKET',
      'S3_SNAPSHOTS_BUCKET',
    ]) {
      expect(message).toContain(`${name} (missing)`);
    }
    expect(message).not.toContain('cli-test-secret-value');
    expect(h.store.sent).toEqual([]);
  });

  it('refuses the same bucket for CVs and snapshots', async () => {
    const h = harness();

    const code = await h.run(['provision'], {
      ...ENV,
      S3_SNAPSHOTS_BUCKET: 'cvs',
    });

    expect(code).toBe(2);
    expect(h.err.join('')).toContain('S3_SNAPSHOTS_BUCKET (invalid)');
  });

  it('exits 2 on an unknown checksum policy without repeating it', async () => {
    const out: string[] = [];
    const err: string[] = [];

    const code = await runObjectStoreCli(['provision'], {
      env: { ...ENV, S3_CONTRACT_CHECKSUM: 'sometimes-secret' },
      io: { out: (t) => out.push(t), err: (t) => err.push(t) },
    });

    expect(code).toBe(2);
    expect(err.join('')).toContain('S3_CONTRACT_CHECKSUM');
    expect(err.join('')).not.toContain('sometimes-secret');
  });

  it('provisions, prints one line per check and exits 0', async () => {
    const h = harness();

    const code = await h.run(['provision']);

    expect(code).toBe(0);
    const output = h.out.join('');
    expect(output).toContain('ok    cvs: bucket created');
    expect(output).toContain('ok    snapshots: bucket created');
    expect(output).toMatch(/provision: ok\n$/);
    expect(h.closed()).toBe(1);
  });

  it('exits 1 naming what provision could not leave as required', async () => {
    const h = harness(
      new FakeS3().on('PutBucketEncryption', 'cvs', () => {
        throw s3Error('AccessDenied', 403);
      }),
    );

    const code = await h.run(['provision']);

    expect(code).toBe(1);
    expect(h.out.join('')).toContain(
      'FAIL  cvs: default encryption: AccessDenied (HTTP 403)',
    );
    expect(h.closed()).toBe(1);
  });

  it('verifies configuration and anonymous access of both buckets and exits 0', async () => {
    const h = harness(provisionedStore());

    const code = await h.run(['verify']);

    expect(code).toBe(0);
    expect(h.out.join('')).toMatch(/verify: ok\n$/);
    expect(h.urls).toEqual([
      expect.stringMatching(
        /^GET http:\/\/127\.0\.0\.1:9\/cvs\/\.verify-probe\/[0-9a-f-]+$/,
      ),
      'GET http://127.0.0.1:9/cvs?list-type=2',
      expect.stringMatching(
        /^PUT http:\/\/127\.0\.0\.1:9\/cvs\/\.verify-probe\/[0-9a-f-]+$/,
      ),
      expect.stringMatching(
        /^GET http:\/\/127\.0\.0\.1:9\/snapshots\/\.verify-probe\//,
      ),
      'GET http://127.0.0.1:9/snapshots?list-type=2',
      expect.stringMatching(
        /^PUT http:\/\/127\.0\.0\.1:9\/snapshots\/\.verify-probe\//,
      ),
    ]);
    const signed = new Set(h.store.names());
    for (const write of WRITE_COMMANDS) {
      expect(signed.has(write)).toBe(false);
    }
    expect(h.closed()).toBe(1);
  });

  it('exits 1 naming the bucket when an anonymous read is granted', async () => {
    const h = harness(provisionedStore(), (url, method) =>
      method === 'GET' && url.includes('/cvs/')
        ? { status: 200, body: Buffer.from('%PDF') }
        : REJECTED,
    );

    const code = await h.run(['verify']);

    expect(code).toBe(1);
    expect(h.out.join('')).toContain(
      'FAIL  cvs: anonymous GET of a missing object: access granted (HTTP 200)',
    );
  });

  it('exits 1 when verify finds a lifecycle rule, naming bucket and rule', async () => {
    const h = harness(
      provisionedStore().on(
        'GetBucketLifecycleConfiguration',
        'snapshots',
        () => ({
          Rules: [
            { ID: 'expire', Status: 'Enabled', Expiration: { Days: 30 } },
          ],
        }),
      ),
    );

    const code = await h.run(['verify']);

    expect(code).toBe(1);
    const output = h.out.join('');
    expect(output).toContain('FAIL  snapshots: lifecycle rule "expire"');
    expect(output).toMatch(/verify: FAILED \(1\)/);
    expect(h.closed()).toBe(1);
  });
});
