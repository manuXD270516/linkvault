import { createServer } from 'node:net';
import {
  healthReadinessResponseSchema,
  type HealthReadinessResponse,
} from '@linkvault/shared';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { afterEach, describe, expect, it } from 'vitest';
import { getMongoTestUri } from '../mongo/mongo-test-client';
import {
  RedisPingDouble,
  type RedisDoubleMode,
} from '../redis/redis-ping-double';
import { MONGOMS_VERSION } from '../testing.preset';

/** Dependencias con las que se arranca la app bajo prueba. */
export interface HealthContractDependencies {
  readonly mongoUri: string;
  readonly redisUrl: string;
}

/** App escuchando en un puerto real; `baseUrl` sin barra final. */
export interface RunningHealthApp {
  readonly baseUrl: string;
  close(): Promise<void>;
}

export interface HealthContractTarget {
  /** Valor esperado de `service` en el cuerpo. */
  readonly service: string;
  start(dependencies: HealthContractDependencies): Promise<RunningHealthApp>;
}

/** Tope de la respuesta completa de `GET /health` (spec runtime-health). */
export const HEALTH_RESPONSE_BUDGET_MS = 1_500;
const WARM_UP_TIMEOUT_MS = 10_000;
const RECOVERY_TIMEOUT_MS = 15_000;
const MONGO_LATE_START_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 200;

interface HealthProbe {
  readonly statusCode: number;
  readonly elapsedMs: number;
  readonly text: string;
  readonly body: HealthReadinessResponse;
}

async function probeHealth(baseUrl: string): Promise<HealthProbe> {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/health`);
  const text = await response.text();
  const elapsedMs = Date.now() - startedAt;
  return {
    statusCode: response.status,
    elapsedMs,
    text,
    body: healthReadinessResponseSchema.parse(JSON.parse(text)),
  };
}

/** Sondea `GET /health` hasta que `accept` se cumple o vence `timeoutMs`; devuelve la última respuesta. */
async function pollHealth(
  baseUrl: string,
  accept: (probe: HealthProbe) => boolean,
  timeoutMs: number,
): Promise<HealthProbe> {
  const deadline = Date.now() + timeoutMs;
  let probe = await probeHealth(baseUrl);
  while (!accept(probe) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    probe = await probeHealth(baseUrl);
  }
  return probe;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('freePort: unexpected server address'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

/**
 * Suite de integración del contrato de `GET /health` (tareas 6.3, 6.4 y 6.5 de bootstrap-monorepo),
 * parametrizada por app. MongoDB es el replica set del globalSetup (salvo la fila de arranque tardío) y
 * Redis el doble RESP de este paquete.
 */
export function describeHealthContract(target: HealthContractTarget): void {
  describe(`${target.service} GET /health contract`, () => {
    const cleanups: Array<() => Promise<void>> = [];

    afterEach(async () => {
      for (const cleanup of cleanups.splice(0).reverse()) {
        await cleanup();
      }
    });

    async function startApp(
      dependencies: HealthContractDependencies,
    ): Promise<RunningHealthApp> {
      const app = await target.start(dependencies);
      cleanups.push(() => app.close());
      return app;
    }

    async function startRedis(mode: RedisDoubleMode): Promise<RedisPingDouble> {
      const redis = await RedisPingDouble.start('up');
      cleanups.push(() => redis.close());
      await redis.setMode(mode);
      return redis;
    }

    function expectBody(
      probe: HealthProbe,
      mongo: 'up' | 'down',
      redis: 'up' | 'down',
    ): void {
      expect(probe.body).toEqual({
        status: mongo === 'up' && redis === 'up' ? 'up' : 'down',
        service: target.service,
        version: expect.any(String),
        checks: { mongo: { status: mongo }, redis: { status: redis } },
      });
    }

    it(
      'responds 200 with mongo and redis up',
      async () => {
        const redis = await startRedis('up');
        const app = await startApp({
          mongoUri: getMongoTestUri(),
          redisUrl: redis.url,
        });

        const probe = await pollHealth(
          app.baseUrl,
          (p) => p.statusCode === 200,
          WARM_UP_TIMEOUT_MS,
        );

        expect(probe.statusCode).toBe(200);
        expectBody(probe, 'up', 'up');
      },
      WARM_UP_TIMEOUT_MS + 5_000,
    );

    it(
      'responds 503 with redis down when Redis stops, keeping mongo up',
      async () => {
        const redis = await startRedis('up');
        const app = await startApp({
          mongoUri: getMongoTestUri(),
          redisUrl: redis.url,
        });
        expect(
          (
            await pollHealth(
              app.baseUrl,
              (p) => p.statusCode === 200,
              WARM_UP_TIMEOUT_MS,
            )
          ).statusCode,
        ).toBe(200);

        await redis.setMode('stop');
        const probe = await pollHealth(
          app.baseUrl,
          (p) => p.statusCode === 503,
          WARM_UP_TIMEOUT_MS,
        );

        expect(probe.statusCode).toBe(503);
        expectBody(probe, 'up', 'down');
      },
      2 * WARM_UP_TIMEOUT_MS + 5_000,
    );

    it(
      'responds 503 within 1500 ms when a dependency accepts connections but never answers',
      async () => {
        const redis = await startRedis('up');
        const app = await startApp({
          mongoUri: getMongoTestUri(),
          redisUrl: redis.url,
        });
        expect(
          (
            await pollHealth(
              app.baseUrl,
              (p) => p.statusCode === 200,
              WARM_UP_TIMEOUT_MS,
            )
          ).statusCode,
        ).toBe(200);

        await redis.setMode('hang');
        const probe = await probeHealth(app.baseUrl);

        expect(probe.statusCode).toBe(503);
        expect(probe.elapsedMs).toBeLessThanOrEqual(HEALTH_RESPONSE_BUDGET_MS);
        expectBody(probe, 'up', 'down');
      },
      WARM_UP_TIMEOUT_MS + 5_000,
    );

    it(
      'does not leak the URI, credentials or driver messages for an unreachable MongoDB',
      async () => {
        const user = 'lv-health-user';
        const password = 'lv-health-s3cr3t';
        const port = await freePort();
        const mongoUri = `mongodb://${user}:${password}@127.0.0.1:${port}/linkvault?directConnection=true`;
        const redis = await startRedis('up');
        const app = await startApp({ mongoUri, redisUrl: redis.url });

        // Espera a Redis para que el 503 se deba solo a MongoDB.
        const probe = await pollHealth(
          app.baseUrl,
          (p) => p.body.checks.redis.status === 'up',
          WARM_UP_TIMEOUT_MS,
        );

        expect(probe.statusCode).toBe(503);
        expectBody(probe, 'down', 'up');
        for (const leak of [
          mongoUri,
          'mongodb://',
          user,
          password,
          String(port),
          'ECONNREFUSED',
          'MongoServerSelectionError',
          'Server selection',
          'timed out',
        ]) {
          expect(probe.text).not.toContain(leak);
        }
      },
      WARM_UP_TIMEOUT_MS + 5_000,
    );

    it(
      'goes back to 200 without restarting when Redis comes back',
      async () => {
        const redis = await startRedis('stop');
        const app = await startApp({
          mongoUri: getMongoTestUri(),
          redisUrl: redis.url,
        });
        const down = await pollHealth(
          app.baseUrl,
          (p) => p.body.checks.mongo.status === 'up',
          WARM_UP_TIMEOUT_MS,
        );
        expect(down.statusCode).toBe(503);
        expectBody(down, 'up', 'down');

        await redis.setMode('up');
        const recovered = await pollHealth(
          app.baseUrl,
          (p) => p.statusCode === 200,
          RECOVERY_TIMEOUT_MS,
        );

        expect(recovered.statusCode).toBe(200);
        expectBody(recovered, 'up', 'up');
      },
      WARM_UP_TIMEOUT_MS + RECOVERY_TIMEOUT_MS + 5_000,
    );

    it(
      'goes back to 200 without restarting when MongoDB starts after the app',
      async () => {
        const port = await freePort();
        const redis = await startRedis('up');
        const app = await startApp({
          mongoUri: `mongodb://127.0.0.1:${port}/linkvault?directConnection=true`,
          redisUrl: redis.url,
        });
        const down = await pollHealth(
          app.baseUrl,
          (p) => p.body.checks.redis.status === 'up',
          WARM_UP_TIMEOUT_MS,
        );
        expect(down.statusCode).toBe(503);
        expectBody(down, 'down', 'up');

        const replSet = await MongoMemoryReplSet.create({
          binary: { version: MONGOMS_VERSION },
          instanceOpts: [{ port }],
          replSet: { count: 1, ip: '127.0.0.1', storageEngine: 'wiredTiger' },
        });
        cleanups.push(async () => {
          await replSet.stop();
        });
        await replSet.waitUntilRunning();

        const recovered = await pollHealth(
          app.baseUrl,
          (p) => p.statusCode === 200,
          MONGO_LATE_START_TIMEOUT_MS,
        );

        expect(recovered.statusCode).toBe(200);
        expectBody(recovered, 'up', 'up');
      },
      MONGO_LATE_START_TIMEOUT_MS + 30_000,
    );
  });
}
