import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65_535);

/**
 * Configuración de `worker` (D8 de bootstrap-monorepo). Igual que la de `api` salvo el puerto: el worker
 * solo escucha en `WORKER_HEALTH_PORT` para exponer su salud (D9). Todas obligatorias salvo `APP_VERSION`.
 * Las variables de MinIO (`S3_*`) están en `.env.example` pero no se validan hasta que algún código las lea.
 */
export const workerConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  WORKER_HEALTH_PORT: port,
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

export type WorkerConfig = z.output<typeof workerConfigSchema>;
