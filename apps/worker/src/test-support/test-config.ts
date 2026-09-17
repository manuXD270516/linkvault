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
