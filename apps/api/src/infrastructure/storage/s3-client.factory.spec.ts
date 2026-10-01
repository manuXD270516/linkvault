import { createServer, type Server, type Socket } from 'node:net';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createS3Client,
  readChecksumPolicy,
  S3_TIMEOUTS,
  s3ClientConfig,
} from './s3-client.factory';

// La fábrica decide la política de checksums y los plazos de todo cliente S3 de `api` (design D3 de `object-store`).
// Se comprueba sobre el cliente construido (lo que el SDK va a usar), no solo sobre el objeto de configuración, y el
// plazo de petición además con un servidor que acepta la conexión y no responde: el SDK instalado solo avisa al
// vencer `requestTimeout` si no se le pide lanzar.

const SETTINGS = {
  endpoint: 'http://127.0.0.1:9',
  region: 'us-east-1',
  accessKey: 'factory-test',
  secretKey: 'factory-test-secret',
};

/** El manejador HTTP del SDK resuelve su configuración en una promesa, antes de la primera petición. */
interface HandlerWithConfig {
  readonly configProvider: Promise<Record<string, unknown>>;
}

async function handlerConfig(
  client: ReturnType<typeof createS3Client>,
): Promise<Record<string, unknown>> {
  const handler = client.config.requestHandler as unknown as HandlerWithConfig;
  return handler.configProvider;
}

describe('readChecksumPolicy', () => {
  it('is the SDK default when S3_CONTRACT_CHECKSUM is absent or empty', () => {
    expect(readChecksumPolicy({})).toBe('when_supported');
    expect(readChecksumPolicy({ S3_CONTRACT_CHECKSUM: '' })).toBe(
      'when_supported',
    );
  });

  it('forces the alternative only with S3_CONTRACT_CHECKSUM=when_required', () => {
    expect(readChecksumPolicy({ S3_CONTRACT_CHECKSUM: 'when_required' })).toBe(
      'when_required',
    );
  });

  it('rejects any other value without repeating it', () => {
    expect(() =>
      readChecksumPolicy({ S3_CONTRACT_CHECKSUM: 'WHEN-REQUIRED-typo' }),
    ).toThrow(/S3_CONTRACT_CHECKSUM/);
    try {
      readChecksumPolicy({ S3_CONTRACT_CHECKSUM: 'WHEN-REQUIRED-typo' });
    } catch (error: unknown) {
      expect(String(error)).not.toContain('typo');
    }
  });
});

describe('createS3Client', () => {
  it('uses the endpoint, region, path-style addressing and credentials it is given', async () => {
    const client = createS3Client(SETTINGS, { env: {} });

    expect(client.config.forcePathStyle).toBe(true);
    expect(await client.config.region()).toBe('us-east-1');
    const credentials = await client.config.credentials();
    expect(credentials.accessKeyId).toBe('factory-test');
    expect(credentials.secretAccessKey).toBe('factory-test-secret');
    const endpoint = await client.config.endpoint?.();
    expect(endpoint?.hostname).toBe('127.0.0.1');
    expect(endpoint?.port).toBe(9);
  });

  it('calculates and validates checksums whenever supported by default', async () => {
    const client = createS3Client(SETTINGS, { env: {} });

    expect(await client.config.requestChecksumCalculation()).toBe(
      'WHEN_SUPPORTED',
    );
    expect(await client.config.responseChecksumValidation()).toBe(
      'WHEN_SUPPORTED',
    );
  });

  it('switches both checksum settings to WHEN_REQUIRED when forced', async () => {
    const client = createS3Client(SETTINGS, {
      env: { S3_CONTRACT_CHECKSUM: 'when_required' },
    });

    expect(await client.config.requestChecksumCalculation()).toBe(
      'WHEN_REQUIRED',
    );
    expect(await client.config.responseChecksumValidation()).toBe(
      'WHEN_REQUIRED',
    );
  });

  it('refuses to build a client with an unknown checksum policy', () => {
    expect(() =>
      createS3Client(SETTINGS, { env: { S3_CONTRACT_CHECKSUM: 'always' } }),
    ).toThrow(/S3_CONTRACT_CHECKSUM/);
  });

  it('sets a connection timeout and a request timeout that throws', async () => {
    const config = await handlerConfig(createS3Client(SETTINGS, { env: {} }));

    expect(config['connectionTimeout']).toBe(S3_TIMEOUTS.connectionTimeoutMs);
    expect(config['requestTimeout']).toBe(S3_TIMEOUTS.requestTimeoutMs);
    expect(config['throwOnRequestTimeout']).toBe(true);
    expect(S3_TIMEOUTS.connectionTimeoutMs).toBeGreaterThan(0);
    expect(S3_TIMEOUTS.requestTimeoutMs).toBeGreaterThan(0);
  });

  it('reads the policy from the process environment when no env is given', () => {
    const config = s3ClientConfig(SETTINGS);
    const expected =
      process.env['S3_CONTRACT_CHECKSUM'] === 'when_required'
        ? 'WHEN_REQUIRED'
        : 'WHEN_SUPPORTED';

    expect(config.requestChecksumCalculation).toBe(expected);
  });
});

describe('createS3Client against a store that accepts and never answers', () => {
  let server: Server | undefined;
  const sockets: Socket[] = [];

  afterEach(async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve) => {
      if (server === undefined) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    server = undefined;
  });

  it('fails the request once its request timeout expires instead of hanging', async () => {
    server = createServer((socket) => {
      // Acepta la conexión y no contesta nunca.
      sockets.push(socket);
    });
    const port = await new Promise<number>((resolve, reject) => {
      server?.once('error', reject);
      server?.listen(0, '127.0.0.1', () => {
        const address = server?.address();
        if (
          address === null ||
          address === undefined ||
          typeof address === 'string'
        ) {
          reject(new Error('unexpected server address'));
          return;
        }
        resolve(address.port);
      });
    });
    const client = createS3Client(
      { ...SETTINGS, endpoint: `http://127.0.0.1:${port}` },
      {
        env: {},
        timeouts: { connectionTimeoutMs: 1_000, requestTimeoutMs: 200 },
      },
    );

    const started = Date.now();
    await expect(
      client.send(new HeadBucketCommand({ Bucket: 'never-answers' })),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    // Tres intentos del SDK con su espera entre ellos; sin plazo que lance, esto no terminaría nunca.
    expect(Date.now() - started).toBeLessThan(8_000);
    client.destroy();
  }, 15_000);
});
