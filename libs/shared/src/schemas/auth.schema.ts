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

/** Cuerpo de `POST /api/auth/forgot-password` (anti-enumeración: siempre 200 genérico tras el límite). */
export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

/** Respuesta genérica de forgot-password y verify-email/resend (mismo cuerpo exista o no la cuenta). */
export const authEmailAckResponseSchema = z.strictObject({
  message: z.string().min(1),
});
export type AuthEmailAckResponse = z.infer<typeof authEmailAckResponseSchema>;

/** Cuerpo de `POST /api/auth/reset-password`. */
export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/** Cuerpo de `POST /api/auth/verify-email`. */
export const verifyEmailRequestSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

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
  // 400: token de verificación o reset ausente, inválido, usado o caducado (mismo cuerpo; ADR-034).
  'invalid_token',
  // 415: el cuerpo no tiene el formato que esa ruta acepta. Lo comparten ya dos formatos distintos —JSON en casi
  // todas y `multipart/form-data` en la subida del CV—, así que su mensaje es genérico y el SPA traduce el código.
  // NO es lo mismo que `unsupported_file_type`: una cosa es "el cuerpo de la petición no es lo que esta ruta lee" y
  // otra "el archivo no es PDF ni DOCX", y la pantalla las explica distinto.
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
  // 409: el owner no puede salir de su grupo ni ser expulsado mientras lo sea; para irse, primero nombra owner a otro
  // miembro (`POST /api/groups/:id/owner`).
  'owner_cannot_leave',
  // 409: el owner se nombra owner a sí mismo al transferir la propiedad. Sin texto de UI: el SPA no ofrece ese camino.
  'already_owner',
  // 409: borrado de cuenta bloqueado porque la persona es el único owner de un grupo con otros miembros.
  'sole_owner_with_members',
  // 400: la URL guardada no es `http(s)`, no tiene host o pasa del máximo de caracteres.
  'invalid_url',
  // 400: el texto de la importación pasa del máximo de caracteres.
  'text_too_long',
  // 404: el link no está en ese grupo ni en esa lista privada.
  'link_not_found',
  // 404: el comentario no existe, ya se borró, es de otro link o de otro grupo, o su `:commentId` no tiene formato de
  // identificador (mismo cuerpo).
  'comment_not_found',
  // 400: la edición del preview nombra un campo que no existe en el schema del preview.
  'preview_field_unknown',
  // 409: se pide releer una oferta que la bolsa prohíbe leer, que nos bloquea o que no era una oferta.
  'enrichment_not_retryable',
  // 422: el texto pegado no parece una oferta, o no queda nada de él tras quitarle los datos de contacto.
  'not_a_job_posting',
  // 503, con `Retry-After`: la IA no respondió a tiempo, degradó, o el contador de pegados no responde.
  'extraction_unavailable',
  // 429, con `Retry-After`: quien pega agotó su cuota diaria de IA. Distinto de `too_many_attempts`, cuya ventana es de
  // minutos: decir "inténtalo en un rato" sería mentira cuando hay que esperar al día siguiente.
  'ai_quota_exceeded',
  // 404: la postulación no existe, es de otra persona o su `:id` no tiene formato de identificador (mismo cuerpo).
  'application_not_found',
  // 409: el estado o la etapa cambiaron desde otra pestaña desde que se pintó (`version` distinta).
  'application_conflict',
  // 404: el CV no existe, es de otra persona o su `:id` no tiene formato de identificador (mismo cuerpo en los tres).
  'cv_not_found',
  // 415: el archivo subido no es PDF ni DOCX, o sus bytes, su extensión y su `Content-Type` no apuntan al mismo tipo.
  'unsupported_file_type',
  // 413: el archivo pasa de `CV_MAX_FILE_BYTES`. No se guarda nada, ni siquiera a medias.
  'file_too_large',
  // 409: ya hay `MAX_CV_DOCUMENTS` CV guardados. Nada se borra solo: la persona elige cuál quitar.
  'too_many_cvs',
  // 404: no hay ningún análisis resuelto ni en curso de quien pregunta sobre esa oferta. NO es `link_not_found`: la
  // oferta puede verse y aun así no haber pedido (ni heredado) ningún análisis; el SPA traduce los dos códigos distinto.
  'analysis_not_found',
  // 409: quien pide el análisis no tiene ningún CV guardado.
  'no_cv',
  // 409: el CV elegido todavía se está leyendo (`pending`); reintentar no ayuda hasta que termine la extracción.
  'cv_not_ready',
  // 409: el CV elegido no se pudo leer (`failed`); la salida es subir otro o completar a mano, no reintentar el análisis.
  'cv_not_readable',
  // 409: la oferta no tiene título ni texto de vacante todavía; hay que completar la oferta, no reintentar a ciegas.
  'job_not_ready',
  // 409: el análisis no admite roadmap (degradado, fallido o sin `missingSkills` útiles).
  'roadmap_not_eligible',
  // 409: se activa el consentimiento con una `textVersion` que ya no es la vigente; el perfil no se modifica (D5).
  'consent_text_outdated',
  // 503: fuera de producción sin `AI_VAULT_KEY` válida; no se puede cifrar una clave BYOK (ADR-032 D4).
  'vault_unavailable',
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
