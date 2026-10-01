import {
  CV_BUCKET_ENCRYPTION_MODE,
  type CvBucketEncryptionMode,
} from '@linkvault/shared';
import { formatInvalidVariables, parseEnv } from '../../config/env-parser';
import {
  createS3Client,
  type S3ConnectionSettings,
} from '../s3-client.factory';
import {
  objectStoreConfigSchema,
  type ObjectStoreConfig,
} from './object-store-config';
import { provisionObjectStore } from './provision';
import { type S3Send, sendOf } from './s3-send';
import { verifyObjectStore } from './verify';
import type { AnonymousFetch } from './verify-anonymous';

// Orden `object-store <provision|verify>` (design D4 de `object-store`). En producción corre con la imagen de `api`
// (`node object-store.js …`, tras el `up`); en desarrollo, con el target `api:object-store`. Escribe por stdout una
// línea por comprobación y un resumen, y por stderr los errores de uso y de configuración (nombres de variables, nunca
// sus valores).
//
// Códigos de salida: 0 todo como se exige; 1 algo no quedó como se exige (la salida lo nombra); 2 uso incorrecto o
// configuración inválida.

export interface ObjectStoreCliIo {
  out(text: string): void;
  err(text: string): void;
}

export interface ObjectStoreConnection {
  readonly send: S3Send;
  close(): void;
}

export interface ObjectStoreCliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly io: ObjectStoreCliIo;
  /** Por defecto, el cliente de la fábrica de `api` (design D3). Los tests pasan un `send` falso. */
  readonly connect?: (
    settings: S3ConnectionSettings,
    env: Readonly<Record<string, string | undefined>>,
  ) => ObjectStoreConnection;
  /** Por defecto, `CV_BUCKET_ENCRYPTION_MODE` de `@linkvault/shared` (design D7). */
  readonly encryptionMode?: CvBucketEncryptionMode;
  /** Reloj de `verify` (antigüedad de los snapshots). Por defecto, el del sistema. */
  readonly now?: () => Date;
  /** Peticiones sin firmar de `verify`. Por defecto, `fetch`. */
  readonly fetch?: AnonymousFetch;
}

const USAGE = 'usage: object-store <provision|verify>\n';

function connectWithFactory(
  settings: S3ConnectionSettings,
  env: Readonly<Record<string, string | undefined>>,
): ObjectStoreConnection {
  const client = createS3Client(settings, { env });
  return { send: sendOf(client), close: () => client.destroy() };
}

export function settingsOf(config: ObjectStoreConfig): S3ConnectionSettings {
  return {
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    accessKey: config.S3_ACCESS_KEY,
    secretKey: config.S3_SECRET_KEY,
  };
}

export async function runObjectStoreCli(
  argv: readonly string[],
  deps: ObjectStoreCliDeps,
): Promise<number> {
  const [command, ...rest] = argv;
  if ((command !== 'provision' && command !== 'verify') || rest.length > 0) {
    deps.io.err(USAGE);
    return 2;
  }

  const parsed = parseEnv(objectStoreConfigSchema, deps.env);
  if (!parsed.ok) {
    deps.io.err(formatInvalidVariables('object-store', parsed.invalid));
    return 2;
  }
  const config = parsed.config;
  const buckets = {
    cv: config.S3_BUCKET,
    snapshots: config.S3_SNAPSHOTS_BUCKET,
  };
  const encryptionMode = deps.encryptionMode ?? CV_BUCKET_ENCRYPTION_MODE;

  let connection: ObjectStoreConnection;
  try {
    connection = (deps.connect ?? connectWithFactory)(
      settingsOf(config),
      deps.env,
    );
  } catch (error: unknown) {
    // Solo la política de checksums puede fallar aquí, y su mensaje no repite el valor recibido.
    deps.io.err(
      `[object-store] ${error instanceof Error ? error.message : 'invalid S3 client configuration'}\n`,
    );
    return 2;
  }

  try {
    if (command === 'provision') {
      const report = await provisionObjectStore({
        send: connection.send,
        buckets,
        encryptionMode,
      });
      deps.io.out(report.render('provision'));
      return report.passed ? 0 : 1;
    }
    const report = await verifyObjectStore({
      send: connection.send,
      endpoint: config.S3_ENDPOINT,
      buckets,
      encryptionMode,
      now: deps.now ?? (() => new Date()),
      fetch: deps.fetch,
    });
    deps.io.out(report.render('verify'));
    return report.passed ? 0 : 1;
  } finally {
    connection.close();
  }
}
