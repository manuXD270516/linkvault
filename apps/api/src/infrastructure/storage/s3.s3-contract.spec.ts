import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { CV_FILE_TYPES, cvFileKey } from '@linkvault/shared';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../config/env-parser';
import {
  createS3CvFileUploader,
  S3CvFileStore,
} from '../../modules/cv/infrastructure/s3-cv-file.store';
import {
  createS3CvPrefixStore,
  S3CvUserPrefixDeleter,
} from '../../modules/users/infrastructure/s3-cv-user-prefix.deleter';
import {
  objectStoreConfigSchema,
  type ObjectStoreConfig,
} from './object-store/object-store-config';
import { createS3Client, readChecksumPolicy } from './s3-client.factory';

// **Suite de contrato de `api` contra un almacén de verdad** (design D3 de `object-store`, tarea 2.7). Apagada por
// defecto: la suite normal no necesita contenedores. Se enciende con `S3_CONTRACT=1` y las `S3_*` del almacén (las del
// `.env`, que Nx carga), con los buckets ya aprovisionados (`object-store provision`):
//
//   S3_CONTRACT=1 pnpm nx run api:test -- s3.s3-contract
//
// Usa los **adaptadores reales** con la fábrica de `api`, así que mide la política de checksums que se entrega: la de
// por defecto, o la alternativa con `S3_CONTRACT_CHECKSUM=when_required` (C7 de la matriz).
//
// **Modo C5** (design D2), además con `S3_CONTRACT_C5_DIR=<directorio>`: escribe cuatro buffers aleatorios e
// independientes —A1 (1 MiB) y A2 (1 KiB) al bucket de CV con `S3CvFileStore`, **sin cabeceras SSE**, porque lo que se
// prueba es el cifrado por defecto del bucket; B1 (1 MiB) y B2 (1 KiB) al de snapshots con el cliente de la fábrica—,
// **no los borra**, y vuelca en el directorio `A1.bin`, `A2.bin`, `B1.bin`, `B2.bin` y `manifest.json` (bucket y clave
// de cada uno, para leerlos después con otra clave). 1 KiB queda por debajo del `INLINE_THRESHOLD` de Garage, de unos
// 3 KiB (a confirmar al medir).

const enabled = process.env['S3_CONTRACT'] === '1';
const c5Dir = process.env['S3_CONTRACT_C5_DIR'];

const MIB = 1024 * 1024;
const KIB = 1024;
/** Más de lo que cabe en un `DeleteObjects` (1000): el borrado por prefijo tiene que hacer dos lotes. */
const PREFIX_KEYS = 1001;

function hex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}

/** Un identificador con la forma de un ObjectId, para que las claves sean como las de producción. */
function objectIdLike(): string {
  return hex(12);
}

function loadConfig(): ObjectStoreConfig {
  const parsed = parseEnv(objectStoreConfigSchema, process.env);
  if (!parsed.ok) {
    throw new Error(
      `S3_CONTRACT=1 needs the S3_* of the store: ${parsed.invalid.map((v) => `${v.name} (${v.reason})`).join(', ')}`,
    );
  }
  return parsed.config;
}

/** Claves bajo un prefijo, recorriendo todas las páginas del listado. */
async function countKeys(
  client: S3Client,
  bucket: string,
  prefix: string,
): Promise<number> {
  let count = 0;
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    count += page.Contents?.length ?? 0;
    token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (token !== undefined);
  return count;
}

async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        if (item !== undefined) {
          await run(item);
        }
      }
    },
  );
  await Promise.all(workers);
}

describe.skipIf(!enabled)('S3 contract of api (real store)', () => {
  let config: ObjectStoreConfig;
  let client: S3Client;
  let connection: {
    endpoint: string;
    region: string;
    accessKey: string;
    secretKey: string;
  };

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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs with the checksum policy it was asked for', () => {
    const expected =
      process.env['S3_CONTRACT_CHECKSUM'] === 'when_required'
        ? 'when_required'
        : 'when_supported';
    expect(readChecksumPolicy(process.env)).toBe(expected);
  });

  it('uploads a CV with the real adapter and the same bytes come back', async () => {
    const store = new S3CvFileStore(
      createS3CvFileUploader({ ...connection, bucket: config.S3_BUCKET }),
    );
    const key = cvFileKey(objectIdLike(), objectIdLike());
    const bytes = randomBytes(64 * KIB);

    await store.put(key, bytes, 'pdf');
    try {
      const object = await client.send(
        new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
      );
      expect(object.ContentType).toBe(CV_FILE_TYPES.pdf.mimeType);
      const read = await object.Body?.transformToByteArray();
      expect(Buffer.from(read ?? new Uint8Array()).equals(bytes)).toBe(true);
    } finally {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
      );
    }
  }, 60_000);

  it(`deletes a prefix of ${PREFIX_KEYS} keys in two DeleteObjects batches and leaves it empty`, async () => {
    const userId = objectIdLike();
    const keys = Array.from({ length: PREFIX_KEYS }, () =>
      cvFileKey(userId, objectIdLike()),
    );
    await mapLimit(keys, 32, async (key) => {
      await client.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: key,
          Body: randomBytes(16),
        }),
      );
    });
    expect(await countKeys(client, config.S3_BUCKET, `${userId}/`)).toBe(
      PREFIX_KEYS,
    );

    const batches: number[] = [];
    const send = S3Client.prototype.send;
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(function (
      this: S3Client,
      ...args: Parameters<S3Client['send']>
    ) {
      const [command] = args;
      if (command instanceof DeleteObjectsCommand) {
        batches.push(command.input.Delete?.Objects?.length ?? 0);
      }
      return send.apply(this, args);
    } as S3Client['send']);

    await new S3CvUserPrefixDeleter(
      createS3CvPrefixStore({ ...connection, bucket: config.S3_BUCKET }),
    ).deleteAllForUser(userId);
    vi.restoreAllMocks();

    expect(batches).toEqual([1000, 1]);
    expect(await countKeys(client, config.S3_BUCKET, `${userId}/`)).toBe(0);
  }, 300_000);

  it.skipIf(c5Dir === undefined || c5Dir === '')(
    'C5 mode: writes A1/A2 to the CV bucket without SSE headers and B1/B2 to the snapshots bucket, and dumps them',
    async () => {
      const dir = c5Dir ?? '';
      const buffers = {
        A1: randomBytes(MIB),
        A2: randomBytes(KIB),
        B1: randomBytes(MIB),
        B2: randomBytes(KIB),
      };
      const names = Object.keys(buffers) as (keyof typeof buffers)[];
      for (const a of names) {
        for (const b of names) {
          if (a !== b) {
            expect(buffers[a].equals(buffers[b])).toBe(false);
          }
        }
      }

      const stamp = `${Date.now().toString(16)}-${hex(4)}`;
      const userId = objectIdLike();
      const objects = {
        A1: {
          bucket: config.S3_BUCKET,
          key: cvFileKey(userId, objectIdLike()),
        },
        A2: {
          bucket: config.S3_BUCKET,
          key: cvFileKey(userId, objectIdLike()),
        },
        B1: { bucket: config.S3_SNAPSHOTS_BUCKET, key: `c5-${stamp}/B1.bin` },
        B2: { bucket: config.S3_SNAPSHOTS_BUCKET, key: `c5-${stamp}/B2.bin` },
      };

      // A1 y A2 con el adaptador real del CV: se comprueba que no manda ninguna cabecera SSE.
      const puts: Record<string, unknown>[] = [];
      const send = S3Client.prototype.send;
      vi.spyOn(S3Client.prototype, 'send').mockImplementation(function (
        this: S3Client,
        ...args: Parameters<S3Client['send']>
      ) {
        const [command] = args;
        if (command instanceof PutObjectCommand) {
          puts.push({ ...command.input });
        }
        return send.apply(this, args);
      } as S3Client['send']);
      const store = new S3CvFileStore(
        createS3CvFileUploader({ ...connection, bucket: config.S3_BUCKET }),
      );
      await store.put(objects.A1.key, buffers.A1, 'pdf');
      await store.put(objects.A2.key, buffers.A2, 'pdf');
      vi.restoreAllMocks();
      expect(puts).toHaveLength(2);
      for (const input of puts) {
        for (const field of Object.keys(input)) {
          expect(field).not.toMatch(/^(ServerSideEncryption|SSE)/);
        }
      }

      for (const name of ['B1', 'B2'] as const) {
        await client.send(
          new PutObjectCommand({
            Bucket: objects[name].bucket,
            Key: objects[name].key,
            Body: buffers[name],
            ContentType: 'application/octet-stream',
          }),
        );
      }

      // Lo que el almacén dice del cifrado de cada objeto: una observación, no la prueba (la prueba es leer el disco).
      const reported: Record<string, string> = {};
      for (const name of names) {
        const head = await client.send(
          new HeadObjectCommand({
            Bucket: objects[name].bucket,
            Key: objects[name].key,
          }),
        );
        expect(head.ContentLength).toBe(buffers[name].length);
        reported[name] = head.ServerSideEncryption ?? 'none reported';
      }

      mkdirSync(dir, { recursive: true });
      for (const name of names) {
        writeFileSync(join(dir, `${name}.bin`), buffers[name]);
      }
      writeFileSync(
        join(dir, 'manifest.json'),
        `${JSON.stringify(
          {
            endpoint: config.S3_ENDPOINT,
            checksumPolicy: readChecksumPolicy(process.env),
            objects: Object.fromEntries(
              names.map((name) => [
                name,
                {
                  ...objects[name],
                  bytes: buffers[name].length,
                  file: `${name}.bin`,
                  serverSideEncryptionReported: reported[name],
                },
              ]),
            ),
          },
          null,
          2,
        )}\n`,
      );
    },
    120_000,
  );
});
