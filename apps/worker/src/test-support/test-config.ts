import { createServer } from 'node:net';
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
