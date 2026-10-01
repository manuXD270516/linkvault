import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { cvFileKey } from '@linkvault/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createS3CvObjectClient,
  S3CvFileReader,
} from '../../modules/cv/infrastructure/storage/s3-cv-file.reader';
import {
  createS3SnapshotUploader,
  S3SnapshotStore,
  snapshotKey,
} from '../../modules/enrichment/infrastructure/storage/s3-snapshot.store';
import { closedPort } from '../../test-support/test-config';
import { parseEnv } from '../config/env-parser';
import { createS3Client, type S3ConnectionSettings } from './s3-client.factory';

// **Suite de contrato del `worker` contra un almacén de verdad** (design D3 de `object-store`, tarea 2.8). Sustituye a
// la antigua prueba local del lector de CV. Apagada por defecto: la suite normal no necesita contenedores. Se enciende
// con `S3_CONTRACT=1` y las `S3_*` del almacén (las del `.env`, que Nx carga), con los buckets ya aprovisionados
// (`object-store provision`):
//
//   S3_CONTRACT=1 pnpm nx run worker:test -- s3.s3-contract
//
// Usa los **adaptadores reales** con la fábrica del `worker`, así que mide la política de checksums que se entrega (la
// alternativa, con `S3_CONTRACT_CHECKSUM=when_required`; C7 de la matriz). Comprueba lo que un doble no puede:
//
// - que se lee lo que se escribió;
// - que borrar lo ya borrado no falla, de lo que depende que consumir dos veces `CvDeleted.v1` sea inofensivo;
// - que un objeto ausente (`null`) se distingue de un almacén caído (error);
// - que el snapshot se guarda comprimido en su bucket.

const enabled = process.env['S3_CONTRACT'] === '1';
const gunzipAsync = promisify(gunzip);

const contractConfigSchema = z.object({
  S3_ENDPOINT: z.string().regex(/^https?:\/\/\S+$/),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(3).max(63),
  S3_SNAPSHOTS_BUCKET: z.string().min(1),
});
type ContractConfig = z.output<typeof contractConfigSchema>;

function loadConfig(): ContractConfig {
  const parsed = parseEnv(contractConfigSchema, process.env);
  if (!parsed.ok) {
    throw new Error(
      `S3_CONTRACT=1 needs the S3_* of the store: ${parsed.invalid.map((v) => `${v.name} (${v.reason})`).join(', ')}`,
    );
  }
  return parsed.config;
}

/** Un identificador con la forma de un ObjectId, para que las claves sean como las de producción. */
function objectIdLike(): string {
  return randomBytes(12).toString('hex');
}

describe.skipIf(!enabled)('S3 contract of worker (real store)', () => {
  let config: ContractConfig;
  let connection: S3ConnectionSettings;
  let client: S3Client;

  beforeAll(() => {
    config = loadConfig();
    connection = {
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      accessKey: config.S3_ACCESS_KEY,
      secretKey: config.S3_SECRET_KEY,
    };
    client = createS3Client(connection);
  });

  function reader(settings: S3ConnectionSettings = connection): S3CvFileReader {
    return new S3CvFileReader(
      createS3CvObjectClient({ ...settings, bucket: config.S3_BUCKET }),
    );
  }

  /** Sube un CV de prueba. Es lo único que el lector no sabe hacer: en el `worker` nadie escribe CV. */
  async function putCv(key: string, bytes: Uint8Array): Promise<void> {
    await client.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: 'application/pdf',
      }),
    );
  }

  it('reads the bytes that were written', async () => {
    const key = cvFileKey(objectIdLike(), objectIdLike());
    const bytes = randomBytes(64 * 1024);
    await putCv(key, bytes);
    try {
      const read = await reader().read(key);
      expect(Buffer.from(read ?? new Uint8Array()).equals(bytes)).toBe(true);
    } finally {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
      );
    }
  }, 60_000);

  it('deletes, and deleting again is still a success', async () => {
    const key = cvFileKey(objectIdLike(), objectIdLike());
    await putCv(key, new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    const cvs = reader();

    await cvs.remove(key);
    await expect(cvs.read(key)).resolves.toBeNull();
    await expect(cvs.remove(key)).resolves.toBeUndefined();
  }, 60_000);

  it('tells a missing object (null) apart from a store that is down (error)', async () => {
    const missing = cvFileKey(objectIdLike(), objectIdLike());

    await expect(reader().read(missing)).resolves.toBeNull();

    const down = {
      ...connection,
      endpoint: `http://127.0.0.1:${await closedPort()}`,
    };
    await expect(reader(down).read(missing)).rejects.toThrow();
  }, 60_000);

  it('stores a gzipped snapshot in the snapshots bucket', async () => {
    const linkId = objectIdLike();
    const html = `<html><body>${'<p>contract</p>'.repeat(200)}${randomBytes(8).toString('hex')}</body></html>`;
    const snapshots = new S3SnapshotStore(
      createS3SnapshotUploader({
        ...connection,
        bucket: config.S3_SNAPSHOTS_BUCKET,
      }),
    );

    const key = await snapshots.save(linkId, 1, html);

    expect(key).toBe(snapshotKey(linkId, 1));
    try {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: config.S3_SNAPSHOTS_BUCKET,
          Key: snapshotKey(linkId, 1),
        }),
      );
      expect(object.ContentEncoding).toBe('gzip');
      const stored = await object.Body?.transformToByteArray();
      const unzipped = await gunzipAsync(
        Buffer.from(stored ?? new Uint8Array()),
      );
      expect(unzipped.toString('utf8')).toBe(html);
    } finally {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.S3_SNAPSHOTS_BUCKET,
          Key: snapshotKey(linkId, 1),
        }),
      );
    }
  }, 60_000);
});
