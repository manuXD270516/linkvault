import { z } from 'zod';

/** Longitud máxima de `displayName` tras eliminar espacios exteriores (spec auth/credentials y users/profile). */
export const DISPLAY_NAME_MAX_LENGTH = 60;

/** Nombre visible: entre 1 y 60 caracteres tras eliminar espacios exteriores. */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(DISPLAY_NAME_MAX_LENGTH);

/**
 * Idioma de salida de la IA (ADR-018). `libs/ai` mantiene su propio tipo `OutputLanguage`; un test de tipos de `api`
 * comprueba que no divergen (D8 de auth-users).
 */
export const outputLanguageSchema = z.enum(['es', 'en']);
export type OutputLanguage = z.infer<typeof outputLanguageSchema>;

/**
 * Consentimiento tal y como sale en `GET /api/users/me` (D4, D5). `currentTextVersion` es siempre la vigente; el
 * cliente detecta solo si `textVersion` ya no coincide. `consentedAt` y `textVersion` son `null` hasta la primera
 * aceptación vigente.
 */
export const aiConsentSchema = z.strictObject({
  externalProviders: z.boolean(),
  consentedAt: z.iso.datetime().nullable(),
  textVersion: z.string().min(1).nullable(),
  currentTextVersion: z.string().min(1),
});
export type AiConsent = z.infer<typeof aiConsentSchema>;

/**
 * Vigente = activo **y** sobre el texto actual. Api, worker y web comparten esta función en vez de reimplementarla
 * (un SPA que mire solo `externalProviders` mentiría tras un cambio de texto).
 */
export function isAiConsentCurrent(
  aiConsent: Pick<
    AiConsent,
    'externalProviders' | 'textVersion' | 'currentTextVersion'
  >,
): boolean {
  return (
    aiConsent.externalProviders &&
    aiConsent.textVersion === aiConsent.currentTextVersion
  );
}

/**
 * Cuerpo de `aiConsent` en `PATCH /api/users/me`. Activar exige `textVersion`; revocar no. `consentedAt` y
 * `currentTextVersion` son desconocidos aquí: el servidor los escribe, el cliente no los manda (D5).
 */
export const updateAiConsentRequestSchema = z
  .strictObject({
    externalProviders: z.boolean(),
    textVersion: z.string().min(1).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.externalProviders === true && body.textVersion === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['textVersion'],
        message: 'textVersion is required when enabling external providers',
      });
    }
  });
export type UpdateAiConsentRequest = z.infer<
  typeof updateAiConsentRequestSchema
>;

/**
 * Cuerpo de `GET /api/users/me` y perfil de las respuestas de sesión. Estricto a propósito: el perfil no expone nada
 * más que estos campos (ni el hash de la contraseña ni `passwordChangedAt`).
 */
export const userProfileSchema = z.strictObject({
  id: z.string().min(1),
  email: z.email(),
  displayName: displayNameSchema,
  aiConsent: aiConsentSchema,
  outputLanguage: outputLanguageSchema,
  redactName: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

/**
 * Cuerpo de `PATCH /api/users/me`: subconjunto no vacío de los campos editables. Un campo desconocido (incluidos
 * `email`, `password`, `consentedAt` y `currentTextVersion`) invalida la petición.
 */
export const updateProfileRequestSchema = z
  .strictObject({
    displayName: displayNameSchema.optional(),
    aiConsent: updateAiConsentRequestSchema.optional(),
    outputLanguage: outputLanguageSchema.optional(),
    redactName: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;

/**
 * Cuerpo de `DELETE /api/users/me` (spec users/account-deletion). Misma política que login: no exige longitud mínima
 * de contraseña nueva, para que una incorrecta responda `invalid_credentials` y no `400`.
 */
export const deleteAccountRequestSchema = z.object({
  password: z.string().min(1).max(128),
});
export type DeleteAccountRequest = z.infer<typeof deleteAccountRequestSchema>;
