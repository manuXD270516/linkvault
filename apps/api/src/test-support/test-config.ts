import { createServer } from 'node:net';
import type { ApiConfig } from '../infrastructure/config/api-config.schema';

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

/** Configuración válida para tests; por defecto Mongo y Redis apuntan a puertos cerrados. */
export async function apiTestConfig(
  overrides: Partial<ApiConfig> = {},
): Promise<ApiConfig> {
  return {
    NODE_ENV: 'test',
    API_PORT: 0,
    MONGO_URI: `mongodb://127.0.0.1:${await closedPort()}/linkvault?directConnection=true`,
    REDIS_URL: `redis://127.0.0.1:${await closedPort()}`,
    AI_CHAIN: 'mock',
    FEATURE_HEADLESS_EXTRACTION: false,
    LOG_LEVEL: 'silent',
    AUTH_JWT_SECRET: 'test-only-jwt-secret-at-least-32-chars',
    AUTH_ACCESS_TOKEN_TTL_SECONDS: 900,
    AUTH_REFRESH_TTL_DAYS: 30,
    AUTH_REFRESH_MAX_DAYS: 90,
    // Relay apagado (D6 de job-links): los tests no lanzan timers ni registran la cola contra el Redis cerrado.
    OUTBOX_RELAY_ENABLED: false,
    OUTBOX_RELAY_INTERVAL_MS: 1000,
    ...overrides,
  };
}
