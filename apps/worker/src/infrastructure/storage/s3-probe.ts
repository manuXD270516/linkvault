import { randomBytes } from 'node:crypto';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import type { CvFileReader } from '../../modules/cv/application/ports/cv-file-reader.port';
import {
  createS3CvObjectClient,
  S3CvFileReader,
} from '../../modules/cv/infrastructure/storage/s3-cv-file.reader';
import { formatInvalidVariables, parseEnv } from '../config/env-parser';
import { workerConfigSchema } from '../config/worker-config.schema';
import { createS3Client, type S3ConnectionSettings } from './s3-client.factory';

// Sonda del `worker` contra el almacén (tarea 7.5 de `object-store`, design D4, D15 y «SSE-C y TLS» de D2). Comprueba
// que el `worker` alcanza el bucket de CV **con su propia configuración**: su fábrica de cliente S3 y su lector de CV,
// dentro del paquete de webpack (un `node -e` no llega a la fábrica). En `verify-artifact.sh` corre como
// `dc run --rm --no-deps worker node s3-probe.js`.
//
// 1. `HeadBucket` firmado del bucket de CV, con el cliente de la fábrica: si falla, sale ≠0 nombrando el bucket y no
//    lee. Así el fallo nombra el bucket sin depender de cómo responda el producto a un `GetObject` en un bucket que no
//    existe (D15).
// 2. Lectura, con el lector de CV del `worker` sobre ese mismo cliente, de una clave de `.verify-probe/` que no existe:
//    tiene que dar `null`. Cualquier error sale ≠0 (un almacén que pase a exigir otra cosa rompe el despliegue y no la
//    primera lectura de un CV), y un objeto con bytes también.
//
// Solo lee: no escribe ni borra nada. No importa `AppModule`: valida solo las `S3_*` que usa, con los campos del
// esquema del `worker`. Nunca imprime credenciales; de un error, solo su nombre.
//
// Códigos de salida: 0 todo como se exige; 1 algo no está como se exige (la salida lo nombra); 2 configuración inválida.

/** Prefijo de las claves de sonda, el mismo que usa la sonda de escritura de `object-store verify` (design D4). */
export const PROBE_PREFIX = '.verify-probe/';

/** Las `S3_*` que la sonda necesita, con la validación del esquema del `worker`. */
export const s3ProbeConfigSchema = z.object({
  S3_ENDPOINT: workerConfigSchema.shape.S3_ENDPOINT,
  S3_REGION: workerConfigSchema.shape.S3_REGION,
  S3_ACCESS_KEY: workerConfigSchema.shape.S3_ACCESS_KEY,
  S3_SECRET_KEY: workerConfigSchema.shape.S3_SECRET_KEY,
  S3_BUCKET: workerConfigSchema.shape.S3_BUCKET,
});

export interface S3ProbeIo {
  out(text: string): void;
  err(text: string): void;
}

/** Lo que la sonda usa del almacén. */
export interface S3ProbeConnection {
  /** `HeadBucket` firmado. Lanza el error del SDK si el bucket no existe o no se puede comprobar. */
  headBucket(bucket: string): Promise<void>;
  /** El lector de CV del `worker` sobre el bucket de CV. */
  readonly reader: CvFileReader;
  close(): void;
}

export interface S3ProbeDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly io: S3ProbeIo;
  /** Por defecto, el cliente de la fábrica del `worker` y su lector de CV. Los tests pasan dobles. */
  readonly connect?: (
    settings: S3ConnectionSettings,
    bucket: string,
    env: Readonly<Record<string, string | undefined>>,
  ) => S3ProbeConnection;
}

/** Un solo cliente de la fábrica para las dos peticiones, y el lector de CV de producción sobre él. */
function connectWithFactory(
  settings: S3ConnectionSettings,
  bucket: string,
  env: Readonly<Record<string, string | undefined>>,
): S3ProbeConnection {
  const client = createS3Client(settings, { env });
  return {
    headBucket: async (name: string): Promise<void> => {
      await client.send(new HeadBucketCommand({ Bucket: name }));
    },
    reader: new S3CvFileReader(
      createS3CvObjectClient({ ...settings, bucket }, client),
    ),
    close: () => {
      client.destroy();
    },
  };
}

/** Nombre del error y, si lo hay, su estado HTTP (a un `HEAD` sin cuerpo el SDK lo llama `Unknown`). Nunca el mensaje. */
function errorName(error: unknown): string {
  const name =
    error instanceof Error && error.name !== '' ? error.name : 'UnknownError';
  const status =
    typeof error === 'object' && error !== null
      ? (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata
          ?.httpStatusCode
      : undefined;
  return typeof status === 'number' ? `${name}, HTTP ${status}` : name;
}

/** `true` si el `HeadBucket` dice que el bucket no está (una respuesta sin cuerpo: el nombre puede faltar). */
function meansMissingBucket(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const failed = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    failed.name === 'NoSuchBucket' ||
    failed.name === 'NotFound' ||
    failed.$metadata?.httpStatusCode === 404
  );
}

export async function runS3Probe(deps: S3ProbeDeps): Promise<number> {
  const parsed = parseEnv(s3ProbeConfigSchema, deps.env);
  if (!parsed.ok) {
    deps.io.err(formatInvalidVariables('s3-probe', parsed.invalid));
    return 2;
  }
  const config = parsed.config;
  const bucket = config.S3_BUCKET;
  const settings: S3ConnectionSettings = {
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKey: config.S3_ACCESS_KEY,
    secretKey: config.S3_SECRET_KEY,
  };

  let connection: S3ProbeConnection;
  try {
    connection = (deps.connect ?? connectWithFactory)(settings, bucket, deps.env);
  } catch (error: unknown) {
    // Solo la política de checksums puede fallar aquí, y su mensaje no repite el valor recibido.
    deps.io.err(
      `[s3-probe] ${error instanceof Error ? error.message : 'invalid S3 client configuration'}\n`,
    );
    return 2;
  }

  try {
    try {
      await connection.headBucket(bucket);
    } catch (error: unknown) {
      deps.io.out(
        meansMissingBucket(error)
          ? `FAIL  ${bucket}: CV bucket does not exist (HeadBucket: ${errorName(error)})\n`
          : `FAIL  ${bucket}: CV bucket could not be checked (${errorName(error)})\n`,
      );
      deps.io.out('s3-probe: failed\n');
      return 1;
    }
    deps.io.out(`ok    ${bucket}: CV bucket exists (signed HeadBucket)\n`);

    const key = `${PROBE_PREFIX}${randomBytes(16).toString('hex')}`;
    let bytes: Uint8Array | null;
    try {
      bytes = await connection.reader.read(key);
    } catch (error: unknown) {
      deps.io.out(
        `FAIL  ${bucket}: reading a missing key under ${PROBE_PREFIX} failed (${errorName(error)})\n`,
      );
      deps.io.out('s3-probe: failed\n');
      return 1;
    }
    if (bytes !== null) {
      deps.io.out(
        `FAIL  ${bucket}: a key under ${PROBE_PREFIX} that must not exist returned ${bytes.length} bytes\n`,
      );
      deps.io.out('s3-probe: failed\n');
      return 1;
    }
    deps.io.out(
      `ok    ${bucket}: a missing key under ${PROBE_PREFIX} reads as null with the CV reader\n`,
    );
    deps.io.out('s3-probe: ok\n');
    return 0;
  } finally {
    connection.close();
  }
}
