import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65_535);

/**
 * Secreto de firma de ejemplo de `.env.example` (D9 de auth-users). Sirve en desarrollo; con `NODE_ENV=production` el
 * arranque lo rechaza. El test de configuración comprueba que `.env.example` usa exactamente este valor.
 */
export const AUTH_JWT_SECRET_EXAMPLE =
  'dev-only-change-me-not-a-real-jwt-secret';

/**
 * Configuración de `api` (D8 de bootstrap-monorepo). Todas obligatorias salvo `APP_VERSION`, que inyecta el
 * build y tiene como respaldo la versión de `package.json` (D9). Las variables de MinIO (`S3_*`) están en
 * `.env.example` pero no se validan hasta que algún código las lea.
 */
export const apiConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    API_PORT: port,
    MONGO_URI: z.string().regex(/^mongodb(\+srv)?:\/\/\S+$/),
    REDIS_URL: z.string().regex(/^rediss?:\/\/\S+$/),
    // `none` o lista ordenada de proveedores de IA (design-v0.2 §4.4). Aquí solo se valida la forma: los identificadores
    // conocidos, `AI_MOCK_MODE` (exigido solo si la cadena incluye `mock`) y el resto de reglas viven en `parseAiConfig`
    // de `@linkvault/ai` (D12 de ai-gateway-core, ADR-018 §2).
    AI_CHAIN: z.union([
      z.literal('none'),
      z.string().regex(/^[a-z0-9-]+(,[a-z0-9-]+)*$/),
    ]),
    FEATURE_HEADLESS_EXTRACTION: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true'),
    LOG_LEVEL: z.enum([
      'fatal',
      'error',
      'warn',
      'info',
      'debug',
      'trace',
      'silent',
    ]),
    APP_VERSION: z.string().min(1).optional(),
    // Sesión (D9 de auth-users, ADR-020): secreto HS256 del access token y caducidades del refresh token.
    AUTH_JWT_SECRET: z.string().min(32),
    AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600),
    AUTH_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90),
    AUTH_REFRESH_MAX_DAYS: z.coerce.number().int().min(1).max(365),
    // Relay del outbox (D6 de job-links, ADR-009). Apagado, `api` no registra la cola ni abre conexión a Redis por
    // BullMQ: los eventos esperan en `outbox_events`. El intervalo va en milisegundos; por debajo de 100 ms el relay
    // competiría consigo mismo y por encima de 5 min el enriquecimiento tardaría más que el corte que lo provocó.
    OUTBOX_RELAY_ENABLED: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true'),
    OUTBOX_RELAY_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(300_000),
  })
  // Cada issue lleva `path` con la variable: `parseEnv` descarta los issues que no nombran ninguna.
  .superRefine((config, ctx) => {
    if (config.AUTH_REFRESH_MAX_DAYS < config.AUTH_REFRESH_TTL_DAYS) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_REFRESH_MAX_DAYS'],
        message: 'AUTH_REFRESH_MAX_DAYS must be >= AUTH_REFRESH_TTL_DAYS',
      });
    }
    if (
      config.NODE_ENV === 'production' &&
      config.AUTH_JWT_SECRET === AUTH_JWT_SECRET_EXAMPLE
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_JWT_SECRET'],
        message:
          'AUTH_JWT_SECRET must not be the .env.example value in production',
      });
    }
  });

export type ApiConfig = z.output<typeof apiConfigSchema>;
