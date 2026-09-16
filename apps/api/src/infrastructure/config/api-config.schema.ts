import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65_535);

/**
 * Configuración de `api` (D8 de bootstrap-monorepo). Todas obligatorias salvo `APP_VERSION`, que inyecta el
 * build y tiene como respaldo la versión de `package.json` (D9). Las variables de MinIO (`S3_*`) están en
 * `.env.example` pero no se validan hasta que algún código las lea.
 */
export const apiConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: port,
  MONGO_URI: z.string().regex(/^mongodb(\+srv)?:\/\/\S+$/),
  REDIS_URL: z.string().regex(/^rediss?:\/\/\S+$/),
  // Lista ordenada de proveedores de IA (design-v0.2 §4.4); los nombres válidos los fija ai-gateway-core.
  AI_CHAIN: z.string().regex(/^[a-z0-9-]+(,[a-z0-9-]+)*$/),
  AI_MOCK_MODE: z.enum(['replay', 'synth', 'record']),
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
});

export type ApiConfig = z.output<typeof apiConfigSchema>;
