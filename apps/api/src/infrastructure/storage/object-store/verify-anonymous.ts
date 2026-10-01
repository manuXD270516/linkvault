import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { S3_TIMEOUTS } from '../s3-client.factory';
import type { ObjectStoreReport } from './object-store-report';
import { describeError } from './s3-errors';
import type { S3Send } from './s3-send';

// `object-store verify`, parte de acceso anónimo (design D4 de `object-store`, spec `platform/object-store`, «Sin acceso
// anónimo al almacén»). Por cada bucket, tres peticiones **sin firmar**: `GET` de un objeto, listado y `PUT`. Solo un
// rechazo por falta de autenticación o de permiso cuenta como rechazo, y siempre **sin bytes del objeto** en el cuerpo:
//
// - un `401` o un `403`;
// - un `400` cuyo `<Code>` sea de la familia de autenticación (así responden algunos almacenes a una petición sin
//   firma).
//
// Un `2xx` es acceso concedido; un `404` también es un fallo (el almacén dejó pasar al anónimo a buscar el objeto); y
// cualquier otra respuesta, incluido un `400` con otro código, no cuenta como rechazo.
//
// El `GET` va a un objeto que existe, si el bucket tiene alguno, para poder comprobar que el rechazo no trae sus bytes:
// con firma se lista un objeto y se leen sus primeros 64 bytes (nunca se imprimen, ni su clave, que en el bucket de CV
// lleva el identificador de la persona). En un bucket vacío va a una clave de sonda que no existe.
//
// La sonda de escritura va a `.verify-probe/<aleatorio>`. Si el almacén la acepta, se borra **con firma** y se informa:
// es la única escritura de `verify`, y solo ocurre si el almacén ya aceptó una escritura anónima.

export const AUTH_REJECTION_CODES: readonly string[] = [
  'AccessDenied',
  'MissingSecurityHeader',
  'AuthorizationHeaderMalformed',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
];

export const PROBE_PREFIX = '.verify-probe/';

/** Bytes del objeto que se buscan en el cuerpo de un rechazo. */
const SAMPLE_BYTES = 64;

export interface AnonymousRequest {
  readonly method: 'GET' | 'PUT';
  readonly body?: string;
  readonly signal: AbortSignal;
}

export interface AnonymousResponse {
  readonly status: number;
  readonly body: Uint8Array;
}

/** Petición HTTP sin firmar. La real es `fetch`, sin cabeceras de autenticación. */
export type AnonymousFetch = (
  url: string,
  request: AnonymousRequest,
) => Promise<AnonymousResponse>;

export const fetchAnonymously: AnonymousFetch = async (url, request) => {
  const response = await fetch(url, {
    method: request.method,
    body: request.body,
    signal: request.signal,
  });
  return {
    status: response.status,
    body: new Uint8Array(await response.arrayBuffer()),
  };
};

export interface VerifyAnonymousDeps {
  /** `S3_ENDPOINT`: las peticiones van con el bucket en la ruta, como las del SDK (`forcePathStyle`). */
  readonly endpoint: string;
  /** `send` **firmado**: solo lee una muestra y, si hizo falta, borra la sonda aceptada. */
  readonly send: S3Send;
  readonly fetch?: AnonymousFetch;
  readonly randomId?: () => string;
  readonly timeoutMs?: number;
}

export type AnonymousVerdict =
  | { readonly rejected: true; readonly how: string }
  | { readonly rejected: false; readonly why: string };

function codeOf(body: Uint8Array): string | undefined {
  const match = /<Code>([^<]*)<\/Code>/.exec(
    Buffer.from(body).toString('utf8'),
  );
  return match?.[1];
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  return (
    needle.length > 0 &&
    Buffer.from(haystack).indexOf(Buffer.from(needle)) !== -1
  );
}

/**
 * Clasifica la respuesta a una petición sin firmar. `forbidden` son bytes que un rechazo no puede traer (los del
 * objeto, o el marcador de las entradas de un listado).
 */
export function classifyAnonymousResponse(
  response: AnonymousResponse,
  forbidden: readonly Uint8Array[] = [],
): AnonymousVerdict {
  const { status, body } = response;
  const code = codeOf(body);
  const label =
    code === undefined ? `HTTP ${status}` : `HTTP ${status} ${code}`;
  const authRejection =
    status === 401 ||
    status === 403 ||
    (status === 400 &&
      code !== undefined &&
      AUTH_REJECTION_CODES.includes(code));
  if (authRejection) {
    if (forbidden.some((bytes) => contains(body, bytes))) {
      return {
        rejected: false,
        why: `${label}, but the body carries object data`,
      };
    }
    return { rejected: true, how: label };
  }
  if (status >= 200 && status < 300) {
    return { rejected: false, why: `access granted (${label})` };
  }
  if (status === 404) {
    return {
      rejected: false,
      why: `${label}: the store let the anonymous request look for it`,
    };
  }
  if (status === 400) {
    return { rejected: false, why: `${label} is not an authentication error` };
  }
  return {
    rejected: false,
    why: `${label} is not an authentication rejection`,
  };
}

function objectUrl(endpoint: string, bucket: string, key?: string): string {
  const base = endpoint.endsWith('/') ? endpoint : `${endpoint}/`;
  const path =
    key === undefined
      ? encodeURIComponent(bucket)
      : `${encodeURIComponent(bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`;
  return new URL(path, base).toString();
}

interface Sample {
  readonly key: string;
  readonly bytes: Uint8Array;
}

/** Un objeto del bucket y sus primeros bytes, leídos con firma; `null` si el bucket está vacío. */
async function sampleObject(
  send: S3Send,
  bucket: string,
): Promise<Sample | null> {
  const listing = (await send(
    new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }),
  )) as ListObjectsV2CommandOutput | undefined;
  const key = listing?.Contents?.[0]?.Key;
  if (key === undefined || key === '') {
    return null;
  }
  const object = (await send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=0-${SAMPLE_BYTES - 1}`,
    }),
  )) as GetObjectCommandOutput | undefined;
  const bytes =
    (await object?.Body?.transformToByteArray()) ?? new Uint8Array();
  return { key, bytes };
}

export async function verifyAnonymousAccess(
  deps: VerifyAnonymousDeps,
  buckets: readonly string[],
  report: ObjectStoreReport,
): Promise<void> {
  for (const bucket of buckets) {
    await verifyBucket(deps, bucket, report);
  }
}

async function verifyBucket(
  deps: VerifyAnonymousDeps,
  bucket: string,
  report: ObjectStoreReport,
): Promise<void> {
  const request = deps.fetch ?? fetchAnonymously;
  const timeoutMs = deps.timeoutMs ?? S3_TIMEOUTS.requestTimeoutMs;
  const probeKey = `${PROBE_PREFIX}${(deps.randomId ?? randomUUID)()}`;

  let sample: Sample | null = null;
  try {
    sample = await sampleObject(deps.send, bucket);
  } catch (error: unknown) {
    report.fail(
      `${bucket}: signed read of a sample object: ${describeError(error)}`,
    );
  }

  const check = async (
    what: string,
    url: string,
    method: 'GET' | 'PUT',
    forbidden: readonly Uint8Array[],
  ): Promise<AnonymousVerdict | undefined> => {
    let response: AnonymousResponse;
    try {
      response = await request(url, {
        method,
        body: method === 'PUT' ? 'linkvault verify probe' : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error: unknown) {
      report.fail(
        `${bucket}: anonymous ${what}: request failed (${describeError(error)})`,
      );
      return undefined;
    }
    const verdict = classifyAnonymousResponse(response, forbidden);
    if (verdict.rejected) {
      report.ok(`${bucket}: anonymous ${what} rejected (${verdict.how})`);
    } else {
      report.fail(`${bucket}: anonymous ${what}: ${verdict.why}`);
    }
    return verdict;
  };

  await check(
    sample === null ? 'GET of a missing object' : 'GET of an existing object',
    objectUrl(deps.endpoint, bucket, sample?.key ?? probeKey),
    'GET',
    sample === null ? [] : [sample.bytes],
  );
  await check(
    'listing',
    `${objectUrl(deps.endpoint, bucket)}?list-type=2`,
    'GET',
    [Buffer.from('<Contents>')],
  );
  const put = await check(
    'PUT',
    objectUrl(deps.endpoint, bucket, probeKey),
    'PUT',
    [],
  );

  if (
    put !== undefined &&
    !put.rejected &&
    put.why.startsWith('access granted')
  ) {
    try {
      await deps.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: probeKey }),
      );
      report.note(
        `${bucket}: the anonymous probe object ${probeKey} was deleted with a signed request`,
      );
    } catch (error: unknown) {
      report.fail(
        `${bucket}: could not delete the anonymous probe object ${probeKey}: ${describeError(error)}`,
      );
    }
  }
}
