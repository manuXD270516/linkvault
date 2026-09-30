import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

// Fábrica **única** de `S3Client` de `api` (design D3 de `object-store`, ADR-052 §3). Los adaptadores y el script
// `object-store` crean su cliente aquí, y en ningún otro sitio: así el endpoint, `forcePathStyle`, la política de
// checksums y los plazos se deciden una vez por proceso. El `worker` tiene su copia en
// `apps/worker/src/infrastructure/storage/s3-client.factory.ts`: no vive en `libs/shared` porque esa librería la
// consume `web` y el SDK no debe entrar en su grafo.

/** Lo que identifica al almacén. Son las `S3_*` de la configuración, sin el bucket: el bucket es de cada adaptador. */
export interface S3ConnectionSettings {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
}

/**
 * Plazos del manejador HTTP. Sin ellos, un almacén que acepta la conexión y no responde cuelga el aprovisionamiento y
 * la verificación del artefacto (design D3).
 *
 * - `connectionTimeoutMs`: hasta tener el socket conectado. El almacén está en la misma red que el proceso.
 * - `requestTimeoutMs`: desde que sale la petición hasta las cabeceras de la respuesta, incluido el envío del cuerpo
 *   (un CV de como mucho 5 MiB por la red interna).
 */
export interface S3Timeouts {
  readonly connectionTimeoutMs: number;
  readonly requestTimeoutMs: number;
}

export const S3_TIMEOUTS: S3Timeouts = {
  connectionTimeoutMs: 5_000,
  requestTimeoutMs: 30_000,
};

/**
 * Política de checksums del SDK. `when_supported` es la del SDK instalado (calcula y valida CRC32 siempre que la
 * operación lo admite); `when_required` solo cuando la operación lo exige. La matriz del almacén (C7) prueba primero la
 * de por defecto y solo fuerza la alternativa si la primera falla por checksums.
 */
export type S3ChecksumPolicy = 'when_supported' | 'when_required';

/**
 * Única forma de forzar la política alternativa (design D3): `S3_CONTRACT_CHECKSUM=when_required`, que usa la matriz.
 * No es configuración de la aplicación y por eso no está en el esquema de `api`.
 */
export const S3_CHECKSUM_ENV = 'S3_CONTRACT_CHECKSUM';

/** Lee la política de `S3_CONTRACT_CHECKSUM`. Ausente o vacía, la de por defecto; otro valor, error (sin repetirlo). */
export function readChecksumPolicy(
  env: Readonly<Record<string, string | undefined>>,
): S3ChecksumPolicy {
  const value = env[S3_CHECKSUM_ENV];
  if (value === undefined || value === '') {
    return 'when_supported';
  }
  if (value === 'when_required') {
    return 'when_required';
  }
  // Un error tipográfico no puede dejar la matriz midiendo la política que no creía medir.
  throw new Error(`${S3_CHECKSUM_ENV} must be empty or "when_required"`);
}

export interface S3ClientFactoryOptions {
  /** Entorno del que se lee `S3_CONTRACT_CHECKSUM`. Por defecto, el del proceso. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Solo para tests: plazos más cortos que los de producción. */
  readonly timeouts?: S3Timeouts;
}

/** Configuración del cliente. Separada de `createS3Client` para que el test lea lo que la fábrica decide. */
export function s3ClientConfig(
  settings: S3ConnectionSettings,
  options: S3ClientFactoryOptions = {},
): S3ClientConfig {
  const policy = readChecksumPolicy(options.env ?? process.env);
  const timeouts = options.timeouts ?? S3_TIMEOUTS;
  const checksums =
    policy === 'when_required' ? 'WHEN_REQUIRED' : 'WHEN_SUPPORTED';
  return {
    endpoint: settings.endpoint,
    region: settings.region,
    // Buckets en la ruta y no como subdominio: los almacenes autoalojados no sirven `<bucket>.<host>`.
    forcePathStyle: true,
    credentials: {
      accessKeyId: settings.accessKey,
      secretAccessKey: settings.secretKey,
    },
    // Explícita aunque coincida con la del SDK: un cambio de su valor por defecto no cambia en silencio lo medido.
    requestChecksumCalculation: checksums,
    responseChecksumValidation: checksums,
    requestHandler: {
      connectionTimeout: timeouts.connectionTimeoutMs,
      requestTimeout: timeouts.requestTimeoutMs,
      // Sin esto, el manejador HTTP del SDK solo **avisa** al vencer `requestTimeout` y la petición sigue colgada
      // (`@smithy/node-http-handler` 4.x, `throwOnRequestTimeout`).
      throwOnRequestTimeout: true,
    },
  };
}

export function createS3Client(
  settings: S3ConnectionSettings,
  options: S3ClientFactoryOptions = {},
): S3Client {
  return new S3Client(s3ClientConfig(settings, options));
}
