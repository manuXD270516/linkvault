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
  // 429, con cabecera `Retry-After` en segundos. También lo usan los límites de la importación de links y de los
  // reintentos de lectura de una oferta: para quien lo recibe es lo mismo, "has pedido demasiado, espera".
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
  // 404: el grupo no existe, quien pregunta no es miembro o el `:id` no tiene formato de identificador (mismo cuerpo).
  'group_not_found',
  // 404: el usuario indicado no es miembro del grupo o su `:userId` no tiene formato de identificador.
  'member_not_found',
  // 403: el usuario es miembro del grupo pero la acción exige el rol `owner`.
  'forbidden',
  // 404: código de invitación desconocido o con formato inválido, con el mismo cuerpo en ambos casos.
  'invalid_invite_code',
  // 409: el grupo ya tiene el máximo de miembros.
  'group_full',
  // 409: el usuario ya pertenece al máximo de grupos.
  'too_many_groups',
  // 409: el owner no puede salir de su grupo ni ser expulsado (no hay transferencia de propiedad).
  'owner_cannot_leave',
  // 400: la URL guardada no es `http(s)`, no tiene host o pasa del máximo de caracteres.
  'invalid_url',
  // 400: el texto de la importación pasa del máximo de caracteres.
  'text_too_long',
  // 404: el link no está en ese grupo ni en esa lista privada.
  'link_not_found',
  // 400: la edición del preview nombra un campo que no existe en el schema del preview.
  'preview_field_unknown',
  // 409: se pide releer una oferta que la bolsa prohíbe leer, que nos bloquea o que no era una oferta.
  'enrichment_not_retryable',
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
