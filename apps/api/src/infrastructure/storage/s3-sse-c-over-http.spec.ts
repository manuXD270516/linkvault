import { createHash, randomBytes } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FAKE_STORE_BUCKET,
  FakeStoreServer,
} from '../../test-support/fake-store-server';
import { createS3Client } from './s3-client.factory';

// **Qué hace el SDK instalado con SSE-C por `http://`** (tarea 2.9b (iii) de `object-store`, design D2, «SSE-C y TLS»).
// La red interna del compose habla HTTP; si el SDK se negara a enviar la clave del cliente sin TLS, la salida SSE-C
// (forma (2) de `cv/documents`) no existiría para ningún candidato. Contra el servidor HTTP en proceso de la tarea 2.5,
// un `PutObject` con SSE-C del cliente de la fábrica: el test afirma **lo observado** el 2026-09-26 con
// `@aws-sdk/client-s3` 3.1134.0 —el SDK **envía** las tres cabeceras `x-amz-server-side-encryption-customer-*` por
// `http://`, sin lanzar—, así que una actualización del SDK que cambie ese comportamiento lo pone en rojo.

const SSE_C_HEADERS = [
  'x-amz-server-side-encryption-customer-algorithm',
  'x-amz-server-side-encryption-customer-key',
  'x-amz-server-side-encryption-customer-key-md5',
] as const;

describe('SSE-C over http:// with the installed SDK', () => {
  let store: FakeStoreServer;

  beforeEach(async () => {
    store = new FakeStoreServer();
    store.signedPutAnswer = { status: 200 };
    await store.start();
  });

  afterEach(async () => {
    await store.stop();
  });

  it('sends a PutObject with the three SSE-C headers instead of throwing without sending', async () => {
    expect(store.endpoint.startsWith('http://')).toBe(true);
    const key = randomBytes(32);
    const client = createS3Client(
      {
        endpoint: store.endpoint,
        region: 'us-east-1',
        accessKey: 'sse-c-test',
        secretKey: 'sse-c-test-secret',
      },
      {
        env: {},
        timeouts: { connectionTimeoutMs: 2_000, requestTimeoutMs: 5_000 },
      },
    );

    let thrown: unknown;
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: FAKE_STORE_BUCKET,
          Key: 'sse-c-probe',
          Body: randomBytes(16),
          SSECustomerAlgorithm: 'AES256',
          SSECustomerKey: key.toString('base64'),
        }),
      );
    } catch (error) {
      thrown = error;
    } finally {
      client.destroy();
    }

    const puts = store.requests.filter((r) => r.method === 'PUT');
    // Observado: el SDK no lanza y el servidor recibe el PUT con la clave (si lanzara sin enviar, `puts` estaría vacío).
    expect(thrown).toBeUndefined();
    expect(puts).toHaveLength(1);
    const headers = puts[0]?.headers ?? {};
    for (const name of SSE_C_HEADERS) {
      expect(headers[name], name).toBeDefined();
    }
    expect(headers['x-amz-server-side-encryption-customer-algorithm']).toBe(
      'AES256',
    );
    expect(headers['x-amz-server-side-encryption-customer-key']).toBe(
      key.toString('base64'),
    );
    expect(headers['x-amz-server-side-encryption-customer-key-md5']).toBe(
      createHash('md5').update(key).digest('base64'),
    );
  });
});
