import { cvFileKey } from '@linkvault/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  S3CvFileReader,
  meansMissingObject,
  type CvObjectClient,
} from './s3-cv-file.reader';

// Lo que este adaptador decide y ningún otro sitio puede decidir por él: **distinguir "el objeto no está" de "el
// almacén no responde"**. Es el tercer corte de idempotencia de D8, y confundirlos convierte un job que debería
// terminar en tres reintentos inútiles, o al revés.

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
  it.each(['NoSuchKey', 'NotFound', 'NoSuchBucket'])(
    'recognizes %s as an object that is not there',
    (name) => {
      expect(meansMissingObject(s3Error(name))).toBe(true);
    },
  );

  it('recognizes a 404 whatever its name', () => {
    expect(meansMissingObject(s3Error('SomethingElse', 404))).toBe(true);
  });

  it.each([
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
