import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65_535);

/**
 * URL pública absoluta, `http(s)` y **sin barra final** (D5 de public-preview-share, ADR-027 §4). Se declara y no se
 * deduce de la cabecera `Host`: un `Host` falsificado acabaría dentro de una etiqueta Open Graph que los chats muestran
 * y cachean. Sin barra final para que componer `${base}/p/<slug>` no dé nunca un `//`.
 */
const publicBaseUrl = z
  .string()
  .regex(/^https?:\/\/[^\s/]+(\/[^\s?#]*[^\s/?#])?$/);

/**
 * Secreto de firma de ejemplo de `.env.example` (D9 de auth-users). Sirve en desarrollo; con `NODE_ENV=production` el
 * arranque lo rechaza. El test de configuración comprueba que `.env.example` usa exactamente este valor.
 */
export const AUTH_JWT_SECRET_EXAMPLE =
  'dev-only-change-me-not-a-real-jwt-secret';

/**
 * Configuración de `api` (D8 de bootstrap-monorepo). Todas obligatorias salvo `APP_VERSION`, que inyecta el
 * build y tiene como respaldo la versión de `package.json` (D9). La configuración de IA (`AI_*`, `OLLAMA_*`,
 * `OPENROUTER_*`) no se valida aquí sino con `parseAiConfig` de `@linkvault/ai` en `loadApiConfigOrExit`, igual que
 * en el worker (D1 de paste-job-description).
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
    OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().min(100).max(300_000),
    // Plazo de la lectura de un texto pegado (D1 de paste-job-description), en milisegundos: es el `ctx.signal` de
    // `runTask('extract-pasted-job')`, y la petición HTTP espera como mucho eso. Por debajo de un segundo ningún
    // proveedor real llega a responder; por encima de dos minutos el diálogo lleva demasiado tiempo en "Leyendo…" y un
    // proxy intermedio ya habría cortado la conexión. El resto de la configuración de IA la valida `parseAiConfig`.
    PASTE_EXTRACTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000),
    // Origen desde el que se sirve la página pública `/p/:slug`: es lo que se pega en un chat y lo que va en `og:url`.
    PUBLIC_PAGE_BASE_URL: publicBaseUrl,
    // Origen del SPA: la vista pública `/oferta/:slug` a la que salta la página y la imagen fija de las tarjetas. En
    // producción pueden apuntar al mismo origen; se declaran las dos porque hoy se sirven aparte.
    WEB_BASE_URL: publicBaseUrl,
    // --- Almacenamiento de objetos (ADR-006, ADR-028 §1) ---
    // `api` sube el archivo del CV y nada más: no lo lee, no lo borra y no emite ninguna URL para alcanzarlo. Las
    // cinco son obligatorias porque sin ellas la subida respondería `500` en la primera petición, y un proceso que
    // arranca sabiendo que no puede cumplir su trabajo es peor que uno que se niega a arrancar (Migration Plan).
    S3_ENDPOINT: z.string().regex(/^https?:\/\/\S+$/),
    // MinIO la ignora, pero la firma de la petición la exige.
    S3_REGION: z.string().min(1),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    // Bucket de los CV, privado y sin expiración (lo crea `docker compose`). S3 exige de 3 a 63 caracteres.
    S3_BUCKET: z.string().min(3).max(63),
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
