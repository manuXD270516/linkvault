import { z } from 'zod';
import { displayNameSchema, userProfileSchema } from './user-profile.schema';

/** Política de contraseñas (spec auth/credentials): longitud en caracteres, sin reglas de composición. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Email normalizado (espacios exteriores eliminados y minúsculas) antes de validarlo. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/** Contraseña nueva según la política. La regla "distinta del email" se aplica donde se conoce el email. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH);

/**
 * Contraseña presentada para verificar (login, contraseña actual). No aplica la política, para que una contraseña
 * incorrecta responda `invalid_credentials` y no `400`; el máximo acota el coste de Argon2id.
 */
const presentedPasswordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

/** Cuerpo de `POST /api/auth/register`. */
export const registerRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: displayNameSchema,
  })
  .superRefine((body, ctx) => {
    if (typeof body.password === 'string' && body.password === body.email) {
      ctx.addIssue({
        code: 'custom',
        path: ['password'],
        message: 'Password must not match the email',
      });
    }
  });
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/** Cuerpo de `POST /api/auth/login`. */
export const loginRequestSchema = z.object({
  email: emailSchema,
  password: presentedPasswordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Cuerpo de `POST /api/auth/password`. La regla "distinta del email" la reaplica el dominio de `auth`. */
export const changePasswordRequestSchema = z.object({
  currentPassword: presentedPasswordSchema,
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

/** Cuerpo de las respuestas que inician o renuevan sesión (registro, login, refresh). */
export const sessionResponseSchema = z.strictObject({
  accessToken: z.string().min(1),
  /** Segundos hasta la caducidad del access token. */
  expiresIn: z.number().int().positive(),
  user: userProfileSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/** Códigos de error de la API. El SPA traduce el código, nunca el `message`. */
export const apiErrorCodeSchema = z.enum([
  // 400: cuerpo inválido; `fields` nombra los campos.
  'validation_error',
  // 401: email inexistente o contraseña incorrecta, con el mismo cuerpo.
  'invalid_credentials',
  // 409
  'email_taken',
  // 429, con cabecera `Retry-After` en segundos.
  'too_many_attempts',
  // 401: refresh token ausente, desconocido, caducado, reusado o de una sesión revocada.
  'invalid_refresh',
  // 409: refresh token rotado hace menos de 10 s (ADR-020).
  'refresh_conflict',
  // 403: `POST /api/auth/*` sin `X-Requested-With: linkvault`.
  'csrf_header_missing',
  // 401: access token ausente, inválido, caducado o anterior al último cambio de contraseña.
  'unauthorized',
  // 415: cuerpo que no es `application/json`.
  'unsupported_media_type',
  // 500
  'internal_error',
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

/** Cuerpo de error de la API. `fields` solo nombra campos, nunca incluye sus valores. */
export const apiErrorResponseSchema = z.strictObject({
  code: apiErrorCodeSchema,
  message: z.string(),
  fields: z.array(z.string().min(1)).optional(),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
