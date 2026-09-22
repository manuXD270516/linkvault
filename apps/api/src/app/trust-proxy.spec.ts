import { randomUUID } from 'node:crypto';
import { RedisPingDouble, getMongoTestUri } from '@linkvault/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './create-app';
import { REDIS_APP_CLIENT } from '../infrastructure/redis/redis-app-client';
import { REGISTRATIONS_PER_IP } from '../modules/auth/domain/attempt-limits';
import { apiTestAiConfig, apiTestConfig } from '../test-support/test-config';

const PASSWORD = 'correct-horse-battery';

function mongoDbUri(database: string): string {
  const url = new URL(getMongoTestUri());
  url.pathname = `/${database}`;
  return url.toString();
}

/** Espera a que el cliente de aplicación esté listo; sin eso el limitador falla abierto. */
async function waitForRedis(app: NestFastifyApplication): Promise<void> {
  const redis = app.get<Redis>(REDIS_APP_CLIENT, { strict: false });
  if (redis.status !== 'ready') {
    await new Promise<void>((resolve, reject) => {
      const onReady = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const cleanup = (): void => {
        redis.off('ready', onReady);
        redis.off('error', onError);
      };
      redis.once('ready', onReady);
      redis.once('error', onError);
      void redis.connect().catch(() => undefined);
    });
  }
}

/**
 * Fastify 5 no expone `trustProxy` en `initialConfig` (opción ofuscada). Se comprueba el efecto sobre `request.ip`
 * vía el límite de registro por IP y `X-Forwarded-For`.
 */
describe('TRUST_PROXY and client IP from X-Forwarded-For', () => {
  let redis: RedisPingDouble;
  let withProxy: NestFastifyApplication;
  let withoutProxy: NestFastifyApplication;

  beforeAll(async () => {
    redis = await RedisPingDouble.start('up');
    withProxy = await createApp(
      await apiTestConfig({
        TRUST_PROXY: true,
        MONGO_URI: mongoDbUri(`trust-on-${randomUUID()}`),
        REDIS_URL: redis.url,
      }),
      apiTestAiConfig(),
    );
    withoutProxy = await createApp(
      await apiTestConfig({
        MONGO_URI: mongoDbUri(`trust-off-${randomUUID()}`),
        REDIS_URL: redis.url,
      }),
      apiTestAiConfig(),
    );
    await withProxy.init();
    await withoutProxy.init();
    await withProxy.getHttpAdapter().getInstance().ready();
    await withoutProxy.getHttpAdapter().getInstance().ready();
    await waitForRedis(withProxy);
    await waitForRedis(withoutProxy);
  });

  afterAll(async () => {
    await withProxy.close();
    await withoutProxy.close();
    await redis.close();
  });

  function register(
    app: NestFastifyApplication,
    options: {
      remoteAddress: string;
      forwardedFor?: string;
    },
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: options.remoteAddress,
      headers: {
        'x-requested-with': 'linkvault',
        'content-type': 'application/json',
        ...(options.forwardedFor === undefined
          ? {}
          : { 'x-forwarded-for': options.forwardedFor }),
      },
      payload: {
        email: `ana-${randomUUID()}@example.com`,
        password: PASSWORD,
        displayName: 'Ana',
      },
    });
  }

  it('counts the client IP from X-Forwarded-For when TRUST_PROXY=true', async () => {
    const proxySocket = '10.0.0.1';
    const clientA = '203.0.113.10';
    const clientB = '203.0.113.20';
    const statusesA: number[] = [];
    for (let i = 0; i < REGISTRATIONS_PER_IP + 1; i += 1) {
      const response = await register(withProxy, {
        remoteAddress: proxySocket,
        forwardedFor: clientA,
      });
      statusesA.push(response.statusCode);
    }
    expect(statusesA.slice(0, REGISTRATIONS_PER_IP)).toEqual(
      Array(REGISTRATIONS_PER_IP).fill(201),
    );
    expect(statusesA[REGISTRATIONS_PER_IP]).toBe(429);

    const otherClient = await register(withProxy, {
      remoteAddress: proxySocket,
      forwardedFor: clientB,
    });
    expect(otherClient.statusCode).toBe(201);
  });

  it('ignores X-Forwarded-For when TRUST_PROXY is off', async () => {
    const sharedSocket = '198.51.100.40';
    const statuses: number[] = [];
    for (let i = 0; i < REGISTRATIONS_PER_IP + 1; i += 1) {
      const response = await register(withoutProxy, {
        remoteAddress: sharedSocket,
        forwardedFor: `203.0.113.${i + 1}`,
      });
      statuses.push(response.statusCode);
    }
    expect(statuses.slice(0, REGISTRATIONS_PER_IP)).toEqual(
      Array(REGISTRATIONS_PER_IP).fill(201),
    );
    expect(statuses[REGISTRATIONS_PER_IP]).toBe(429);
  });
});

describe('createApp passes trustProxy to Fastify', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('honours X-Forwarded-For only when TRUST_PROXY=true', async () => {
    const trusted = await createApp(
      await apiTestConfig({ TRUST_PROXY: true }),
      apiTestAiConfig(),
    );
    const untrusted = await createApp(
      await apiTestConfig({ TRUST_PROXY: false }),
      apiTestAiConfig(),
    );
    await trusted.init();
    await untrusted.init();
    app = trusted;

    const probe = async (
      instance: NestFastifyApplication,
    ): Promise<string | undefined> => {
      const fastify = instance.getHttpAdapter().getInstance();
      fastify.get('/__trust_probe', (request, reply) => {
        void reply.send({ ip: request.ip });
      });
      const response = await instance.inject({
        method: 'GET',
        url: '/__trust_probe',
        remoteAddress: '10.0.0.1',
        headers: { 'x-forwarded-for': '203.0.113.50' },
      });
      return (response.json() as { ip?: string }).ip;
    };

    expect(await probe(trusted)).toBe('203.0.113.50');
    expect(await probe(untrusted)).toBe('10.0.0.1');
    await untrusted.close();
  });
});
