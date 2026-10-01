import { S3Client } from '@aws-sdk/client-s3';
import { cvFileKey } from '@linkvault/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  S3CvFileReader,
  createS3CvObjectClient,
  meansMissingObject,
  type CvObjectClient,
} from './s3-cv-file.reader';

// Lo que este adaptador decide y ningún otro sitio puede decidir por él: **distinguir "el objeto no está" de "el
// almacén no responde"**. Es el tercer corte de idempotencia de D8, y confundirlos convierte un job que debería
// terminar en tres reintentos inútiles, o al revés. Y **"el bucket de CV no está" es del segundo tipo** (design D15 de
// `object-store`): solo un error de objeto (`NoSuchKey`, `NotFound`) es un objeto ausente.

const USER = '66e9a0000000000000000a01';
const CV = '66e9a0000000000000000c01';
const KEY = cvFileKey(USER, CV);

class ClientDouble implements CvObjectClient {
  readonly deleted: string[] = [];

  constructor(
    private readonly onGet: () => Promise<Uint8Array | null>,
    private readonly onDelete: () => Promise<void> = () => Promise.resolve(),
  ) {}

  get(): Promise<Uint8Array | null> {
    return this.onGet();
  }

  delete(key: string): Promise<void> {
    this.deleted.push(key);
    return this.onDelete();
  }
}

function s3Error(name: string, httpStatusCode?: number): Error {
  return Object.assign(new Error(`the key ${KEY} is the problem`), {
    name,
    ...(httpStatusCode === undefined ? {} : { $metadata: { httpStatusCode } }),
  });
}

describe('meansMissingObject', () => {
  it.each(['NoSuchKey', 'NotFound'])(
    'recognizes %s as an object that is not there',
    (name) => {
      expect(meansMissingObject(s3Error(name, 404))).toBe(true);
    },
  );

  it.each([
    ['a missing CV bucket (NoSuchBucket, 404)', s3Error('NoSuchBucket', 404)],
    ['a 404 with another name', s3Error('SomethingElse', 404)],
    [
      'a 404 without a name',
      Object.assign(new Error('not found'), {
        name: '',
        $metadata: { httpStatusCode: 404 },
      }),
    ],
    ['a service failure', s3Error('ServiceUnavailable', 503)],
    ['a timeout', s3Error('TimeoutError')],
    ['a plain error', new Error('socket hang up')],
    ['nothing', undefined],
  ])('does not confuse %s with a missing object', (_case, error) => {
    expect(meansMissingObject(error)).toBe(false);
  });
});

describe('S3CvFileReader.read', () => {
  it('returns the bytes of the object', async () => {
    const bytes = new Uint8Array([0x25, 0x50]);
    const reader = new S3CvFileReader(
      new ClientDouble(() => Promise.resolve(bytes)),
    );

    await expect(reader.read(KEY)).resolves.toBe(bytes);
  });

  it('returns null when the object is not there, without throwing', async () => {
    const reader = new S3CvFileReader(
      new ClientDouble(() => Promise.resolve(null)),
    );

    await expect(reader.read(KEY)).resolves.toBeNull();
  });

  it('throws when the store does not answer, so the queue retries', async () => {
    const reader = new S3CvFileReader(
      new ClientDouble(() => Promise.reject(s3Error('ServiceUnavailable', 503))),
    );

    await expect(reader.read(KEY)).rejects.toThrow();
  });

  it('logs the kind of failure and never the key', async () => {
    const reader = new S3CvFileReader(
      new ClientDouble(() => Promise.reject(s3Error('ServiceUnavailable', 503))),
    );
    const warnings: string[] = [];
    const logger = (
      reader as unknown as { logger: { warn: (message: string) => void } }
    ).logger;
    vi.spyOn(logger, 'warn').mockImplementation((message: string) => {
      warnings.push(message);
    });

    await expect(reader.read(KEY)).rejects.toThrow();

    expect(warnings).toEqual(['CV file not read: ServiceUnavailable']);
    expect(JSON.stringify(warnings)).not.toContain(USER);
    expect(JSON.stringify(warnings)).not.toContain(CV);
  });
});

describe('S3CvFileReader over the worker S3 client', () => {
  // El lector real con el cliente real de la fábrica del `worker`; solo `send` es falso, así que se prueba la
  // clasificación que hace `createS3CvObjectClient` al leer y la que hace el lector al borrar.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function readerFailingWith(error: Error): S3CvFileReader {
    vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(error);
    return new S3CvFileReader(
      createS3CvObjectClient({
        endpoint: 'http://127.0.0.1:9',
        region: 'us-east-1',
        accessKey: 'test-access',
        secretKey: 'test-secret',
        bucket: 'cvs',
      }),
    );
  }

  it.each(['NoSuchKey', 'NotFound'])(
    '%s: read gives null and remove resolves',
    async (name) => {
      const reader = readerFailingWith(s3Error(name, 404));

      await expect(reader.read(KEY)).resolves.toBeNull();
      await expect(reader.remove(KEY)).resolves.toBeUndefined();
    },
  );

  it('NoSuchBucket (404): read and remove throw, so the queue retries', async () => {
    const reader = readerFailingWith(s3Error('NoSuchBucket', 404));

    await expect(reader.read(KEY)).rejects.toMatchObject({
      name: 'NoSuchBucket',
    });
    await expect(reader.remove(KEY)).rejects.toMatchObject({
      name: 'NoSuchBucket',
    });
  });

  it('a 404 with another name: read and remove throw', async () => {
    const reader = readerFailingWith(s3Error('SomethingElse', 404));

    await expect(reader.read(KEY)).rejects.toThrow();
    await expect(reader.remove(KEY)).rejects.toThrow();
  });

  it('NoSuchBucket: the warning names the error and never the key', async () => {
    const reader = readerFailingWith(s3Error('NoSuchBucket', 404));
    const warnings: string[] = [];
    const logger = (
      reader as unknown as { logger: { warn: (message: string) => void } }
    ).logger;
    vi.spyOn(logger, 'warn').mockImplementation((message: string) => {
      warnings.push(message);
    });

    await expect(reader.read(KEY)).rejects.toThrow();
    await expect(reader.remove(KEY)).rejects.toThrow();

    expect(warnings).toEqual([
      'CV file not read: NoSuchBucket',
      'CV file not deleted: NoSuchBucket',
    ]);
    expect(JSON.stringify(warnings)).not.toContain(USER);
    expect(JSON.stringify(warnings)).not.toContain(CV);
  });
});

describe('S3CvFileReader.remove', () => {
  it('deletes the object', async () => {
    const client = new ClientDouble(() => Promise.resolve(null));
    const reader = new S3CvFileReader(client);

    await reader.remove(KEY);

    expect(client.deleted).toEqual([KEY]);
  });

  it('treats deleting what is no longer there as a success', async () => {
    const reader = new S3CvFileReader(
      new ClientDouble(
        () => Promise.resolve(null),
        () => Promise.reject(s3Error('NoSuchKey')),
      ),
    );

    await expect(reader.remove(KEY)).resolves.toBeUndefined();
  });

  it('throws when the store does not answer, so the deletion is retried', async () => {
    const reader = new S3CvFileReader(
      new ClientDouble(
        () => Promise.resolve(null),
        () => Promise.reject(s3Error('ServiceUnavailable', 503)),
      ),
    );

    await expect(reader.remove(KEY)).rejects.toThrow();
  });
});
