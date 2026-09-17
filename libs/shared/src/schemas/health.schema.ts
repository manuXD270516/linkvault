import { z } from 'zod';

/** Estado de una comprobación o del servicio completo (spec runtime-health). */
export const healthStatusSchema = z.enum(['up', 'down']);
export type HealthStatus = z.infer<typeof healthStatusSchema>;

const dependencyCheckSchema = z.strictObject({ status: healthStatusSchema });

/**
 * Cuerpo de `GET /health/live`. Estricto a propósito: la salud no expone nada más que estos campos (ni URIs,
 * ni credenciales, ni mensajes de drivers).
 */
export const healthLiveResponseSchema = z.strictObject({
  status: z.literal('up'),
  service: z.string().min(1),
  version: z.string().min(1),
});
export type HealthLiveResponse = z.infer<typeof healthLiveResponseSchema>;

/** Cuerpo de `GET /health`, tanto en 200 como en 503. */
export const healthReadinessResponseSchema = z.strictObject({
  status: healthStatusSchema,
  service: z.string().min(1),
  version: z.string().min(1),
  checks: z.strictObject({
    mongo: dependencyCheckSchema,
    redis: dependencyCheckSchema,
  }),
});
export type HealthReadinessResponse = z.infer<
  typeof healthReadinessResponseSchema
>;
