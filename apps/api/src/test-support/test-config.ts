import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { type AiConfig, parseAiConfig } from '@linkvault/ai';
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
    // El mismo plazo de `.env.example`: en los tests `runTask` es el mock en `replay` o un doble, y responde al instante.
    PASTE_EXTRACTION_TIMEOUT_MS: 20_000,
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
 * Configuración de IA para tests de `api` (D1 de paste-job-description): `mock` en `replay` con los prompts y fixtures
 * reales de `libs/ai`, resueltos contra la raíz del workspace para no depender del directorio desde el que se lance
 * Vitest. Nunca `synth`: un fixture que falta es un fallo, no una salida inventada.
 */
export function apiTestAiConfig(): AiConfig {
  const result = parseAiConfig(
    { NODE_ENV: 'test', AI_CHAIN: 'mock', AI_MOCK_MODE: 'replay' },
    { cwd: workspaceRoot() },
  );
  if (!result.ok) {
    throw new Error(
      `apiTestAiConfig: invalid AI configuration (${result.problems.map((p) => p.variable).join(', ')})`,
    );
  }
  return result.config;
}
