import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { type AiConfig, parseAiConfig } from '@linkvault/ai';
import type { WorkerConfig } from '../infrastructure/config/worker-config.schema';

/** Puerto de 127.0.0.1 que estaba libre y se ha cerrado: las conexiones a él se rechazan. */
export function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('closedPort: unexpected server address'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

/** Configuración válida para tests; por defecto Mongo, Redis y el puerto de salud apuntan a puertos libres. */
export async function workerTestConfig(
  overrides: Partial<WorkerConfig> = {},
): Promise<WorkerConfig> {
  return {
    NODE_ENV: 'test',
    WORKER_HEALTH_PORT: await closedPort(),
    MONGO_URI: `mongodb://127.0.0.1:${await closedPort()}/linkvault?directConnection=true`,
    REDIS_URL: `redis://127.0.0.1:${await closedPort()}`,
    AI_CHAIN: 'mock',
    FEATURE_HEADLESS_EXTRACTION: false,
    LOG_LEVEL: 'silent',
    // Enriquecimiento: los mismos valores de `.env.example`, salvo las esperas, que se acortan porque en los tests
    // `PAGE_FETCHER`, `ROBOTS` y `HOST_MUTEX` son dobles y nadie debe quedarse esperando de verdad.
    ENRICH_FETCH_TIMEOUT_MS: 1_000,
    ENRICH_MAX_BYTES: 2_097_152,
    ENRICH_DOMAIN_DELAY_MS: 250,
    ENRICH_DEADLINE_MS: 5_000,
    ENRICH_ROBOTS_TTL_SECONDS: 43_200,
    ENRICH_USER_AGENT:
      'LinkVaultBot/0.1 (+https://github.com/manuXD270516/linkvault)',
    ENRICH_CONCURRENCY: 4,
    ENRICH_MAX_DEFERRALS: 600,
    // Almacenamiento de objetos: apunta a un puerto cerrado, como Mongo y Redis. Ningún test escribe de verdad en
    // él; `SNAPSHOT_STORE` es un puerto con doble.
    S3_ENDPOINT: `http://127.0.0.1:${await closedPort()}`,
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'test-access-key',
    S3_SECRET_KEY: 'test-secret-key',
    S3_SNAPSHOTS_BUCKET: 'snapshots',
    ...overrides,
  };
}

/** Raíz del workspace (la carpeta con `nx.json`), buscada hacia arriba desde el directorio de trabajo del test. */
function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('workspaceRoot: nx.json not found above the test cwd');
    }
    dir = parent;
  }
  return dir;
}

/**
 * Configuración de IA para tests: `mock` en `replay` con los prompts y fixtures reales de `libs/ai`, resueltos
 * contra la raíz del workspace para no depender del directorio desde el que se lance Vitest.
 */
export function workerTestAiConfig(): AiConfig {
  const result = parseAiConfig(
    { NODE_ENV: 'test', AI_CHAIN: 'mock', AI_MOCK_MODE: 'replay' },
    { cwd: workspaceRoot() },
  );
  if (!result.ok) {
    throw new Error(
      `workerTestAiConfig: invalid AI configuration (${result.problems.map((p) => p.variable).join(', ')})`,
    );
  }
  return result.config;
}
