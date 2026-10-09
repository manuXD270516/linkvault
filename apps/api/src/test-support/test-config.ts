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
    FEATURE_SEARCH: false,
    FEATURE_DISCOVERY: false,
    DISCOVERY_CHAIN: 'mock',
    MEILI_HOST: '',
    MEILI_MASTER_KEY: '',
    MEILI_INDEX: 'lv_content',
    SEARCH_SEMANTIC_RATIO: 0.5,
    SEARCH_BACKFILL_RATE: 5,
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
    // Los mismos orígenes que `.env.example`: los tests de la página pública comprueban que `og:url` sale de aquí.
    PUBLIC_PAGE_BASE_URL: 'http://localhost:3000',
    WEB_BASE_URL: 'http://localhost:4200',
    // Almacenamiento de objetos: apunta a un puerto cerrado, como Mongo y Redis. Ningún test de `api` escribe de
    // verdad en él —`CV_FILE_STORE` es un puerto con doble (ADR-028, "Pruebas")—, y que el endpoint no responda es
    // justo lo que hace ruidoso cualquier olvido de sustituirlo.
    S3_ENDPOINT: `http://127.0.0.1:${await closedPort()}`,
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'test-access-key',
    S3_SECRET_KEY: 'test-secret-key',
    S3_BUCKET: 'cvs',
    // Análisis de encaje: los mismos valores de `.env.example` (holgados respecto al plazo del worker).
    MATCH_ANALYSES_PER_USER: 10,
    MATCH_QUOTA_WINDOW_MS: 86_400_000,
    MATCH_ANALYSIS_MAX_AGE_MS: 240_000,
    MATCH_ANALYSIS_TIMEOUT_MS: 120_000,
    // D12: sin proxy de confianza en tests salvo override explícito.
    TRUST_PROXY: false,
    // Correo: CapturingMailer en tests (sin red / sin Mailpit).
    MAIL_PROVIDER: 'capture',
    MAIL_FROM: 'LinkVault <noreply@example.com>',
    MAIL_SMTP_HOST: 'localhost',
    MAIL_SMTP_PORT: 1025,
    MAIL_SMTP_SECURE: false,
    RESEND_API_KEY: undefined,
    AUTH_VERIFY_TOKEN_TTL_HOURS: 24,
    AUTH_RESET_TOKEN_TTL_SECONDS: 3600,
    VAPID_PUBLIC_KEY: '',
    VAPID_PRIVATE_KEY: '',
    VAPID_SUBJECT: '',
    EXTENSION_CORS_ORIGINS: [],
    ...overrides,
  };
}

/** Raíz del workspace (la carpeta con `nx.json`), buscada hacia arriba desde el directorio de trabajo del test. */
export function workspaceRoot(): string {
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
