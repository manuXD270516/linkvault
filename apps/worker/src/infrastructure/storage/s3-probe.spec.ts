import {
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CvFileReader } from '../../modules/cv/application/ports/cv-file-reader.port';
import {
  PROBE_PREFIX,
  runS3Probe,
  type S3ProbeConnection,
} from './s3-probe';

// Sonda del `worker` contra el almacén (tarea 7.5 de `object-store`, design D4 y D15): con la fábrica y el lector de CV
// del propio `worker`, comprueba que el bucket de CV existe (`HeadBucket` firmado) y que una clave ausente de
// `.verify-probe/` se lee como `null`. Cualquier otra cosa sale ≠0, y el fallo del `HeadBucket` nombra el bucket sin
// llegar a la lectura.

const ENV = {
  S3_ENDPOINT: 'http://127.0.0.1:9',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY: 'probe-test-access',
  S3_SECRET_KEY: 'probe-test-secret-value',
  S3_BUCKET: 'cvs',
};

function s3Error(name: string, httpStatusCode?: number): Error {
  return Object.assign(new Error(`${name} (fake)`), {
    name,
    ...(httpStatusCode === undefined ? {} : { $metadata: { httpStatusCode } }),
  });
}

class FakeReader implements CvFileReader {
  readonly keys: string[] = [];

  constructor(private readonly onRead: () => Promise<Uint8Array | null>) {}

  read(key: string): Promise<Uint8Array | null> {
    this.keys.push(key);
    return this.onRead();
  }

  remove(): Promise<void> {
    return Promise.reject(new Error('the probe never deletes'));
  }
}

function harness(
  reader: FakeReader,
  headBucket: (bucket: string) => Promise<void> = () => Promise.resolve(),
) {
  const out: string[] = [];
  const err: string[] = [];
  const heads: string[] = [];
  let closed = 0;
  const connection: S3ProbeConnection = {
    headBucket: (bucket) => {
      heads.push(bucket);
      return headBucket(bucket);
    },
    reader,
    close: () => {
      closed += 1;
    },
  };
  return {
    out,
    err,
    heads,
    closed: () => closed,
    run: (env: Record<string, string | undefined> = ENV) =>
      runS3Probe({
        env,
        io: { out: (text) => out.push(text), err: (text) => err.push(text) },
        connect: () => connection,
      }),
  };
}

describe('runS3Probe', () => {
  it('exits 0 when the CV bucket exists and a missing probe key reads as null', async () => {
    const reader = new FakeReader(() => Promise.resolve(null));
    const probe = harness(reader);

    await expect(probe.run()).resolves.toBe(0);

    expect(probe.heads).toEqual(['cvs']);
    expect(reader.keys).toHaveLength(1);
    expect(reader.keys[0]?.startsWith(PROBE_PREFIX)).toBe(true);
    expect(probe.out.join('')).toContain('s3-probe: ok');
    expect(probe.closed()).toBe(1);
  });

  it('exits non-zero when the reader throws', async () => {
    const probe = harness(
      new FakeReader(() => Promise.reject(s3Error('ServiceUnavailable', 503))),
    );

    await expect(probe.run()).resolves.toBe(1);

    const output = probe.out.join('');
    expect(output).toContain('cvs');
    expect(output).toContain('ServiceUnavailable');
    expect(output).toContain('s3-probe: failed');
    expect(probe.closed()).toBe(1);
  });

  it('exits non-zero when the reader throws NoSuchBucket', async () => {
    const probe = harness(
      new FakeReader(() => Promise.reject(s3Error('NoSuchBucket', 404))),
    );

    await expect(probe.run()).resolves.toBe(1);

    expect(probe.out.join('')).toContain('NoSuchBucket');
  });

  it('exits non-zero when a key that must not exist returns bytes', async () => {
    const probe = harness(
      new FakeReader(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
    );

    await expect(probe.run()).resolves.toBe(1);
  });

  it.each([
    ['NoSuchBucket (404)', s3Error('NoSuchBucket', 404)],
    ['NotFound (404)', s3Error('NotFound', 404)],
    ['a 404 without a known name', s3Error('UnknownError', 404)],
  ])(
    'HeadBucket with %s: exits non-zero naming the bucket, without reading',
    async (_case, error) => {
      const reader = new FakeReader(() => Promise.resolve(null));
      const probe = harness(reader, () => Promise.reject(error));

      await expect(probe.run()).resolves.toBe(1);

      expect(probe.out.join('')).toContain('cvs: CV bucket does not exist');
      expect(reader.keys).toEqual([]);
      expect(probe.closed()).toBe(1);
    },
  );

  it('HeadBucket refused (403): exits non-zero naming the bucket, without reading', async () => {
    const reader = new FakeReader(() => Promise.resolve(null));
    const probe = harness(reader, () => Promise.reject(s3Error('Forbidden', 403)));

    await expect(probe.run()).resolves.toBe(1);

    expect(probe.out.join('')).toContain(
      'cvs: CV bucket could not be checked (Forbidden, HTTP 403)',
    );
    expect(reader.keys).toEqual([]);
  });

  it('exits 2 naming the missing variables, never their values', async () => {
    const probe = harness(new FakeReader(() => Promise.resolve(null)));

    await expect(
      probe.run({ ...ENV, S3_BUCKET: undefined, S3_ENDPOINT: 'not a url' }),
    ).resolves.toBe(2);

    const errors = probe.err.join('');
    expect(errors).toContain('S3_BUCKET');
    expect(errors).toContain('S3_ENDPOINT');
    expect(errors).not.toContain(ENV.S3_SECRET_KEY);
    expect(probe.heads).toEqual([]);
  });
});

describe('runS3Probe with the worker S3 client', () => {
  // La conexión real: el cliente de la fábrica del `worker` y el lector de CV sobre ese mismo cliente. Solo `send` es
  // falso, así que se prueba lo que se envía y cómo clasifica el lector lo que responde el almacén.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function sendAnswering(
    onHead: () => Promise<unknown>,
    onGet: () => Promise<unknown>,
  ): unknown[] {
    const sent: unknown[] = [];
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(((
      command: unknown,
    ) => {
      sent.push(command);
      if (command instanceof HeadBucketCommand) {
        return onHead();
      }
      if (command instanceof GetObjectCommand) {
        return onGet();
      }
      return Promise.reject(new Error('unexpected command'));
    }) as S3Client['send']);
    return sent;
  }

  function run() {
    const out: string[] = [];
    return {
      out,
      code: runS3Probe({
        env: ENV,
        io: { out: (text) => out.push(text), err: (text) => out.push(text) },
      }),
    };
  }

  it('sends a signed HeadBucket and a GetObject under .verify-probe/ to the CV bucket; NoSuchKey is 0', async () => {
    const sent = sendAnswering(
      () => Promise.resolve({}),
      () => Promise.reject(s3Error('NoSuchKey', 404)),
    );

    const probe = run();
    await expect(probe.code).resolves.toBe(0);

    expect(sent).toHaveLength(2);
    expect(sent[0]).toBeInstanceOf(HeadBucketCommand);
    expect((sent[0] as HeadBucketCommand).input).toEqual({ Bucket: 'cvs' });
    expect(sent[1]).toBeInstanceOf(GetObjectCommand);
    const get = (sent[1] as GetObjectCommand).input;
    expect(get.Bucket).toBe('cvs');
    expect(get.Key?.startsWith(PROBE_PREFIX)).toBe(true);
  });

  it('the real reader throwing NoSuchBucket is non-zero', async () => {
    sendAnswering(
      () => Promise.resolve({}),
      () => Promise.reject(s3Error('NoSuchBucket', 404)),
    );

    const probe = run();
    await expect(probe.code).resolves.toBe(1);
    expect(probe.out.join('')).toContain('NoSuchBucket');
  });

  it('HeadBucket NotFound with the real client: non-zero naming the bucket, and no GetObject', async () => {
    const sent = sendAnswering(
      () => Promise.reject(s3Error('NotFound', 404)),
      () => Promise.resolve({}),
    );

    const probe = run();
    await expect(probe.code).resolves.toBe(1);

    expect(probe.out.join('')).toContain('cvs: CV bucket does not exist');
    expect(sent).toHaveLength(1);
  });
});
