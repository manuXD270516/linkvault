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

/** Consentimiento para enviar datos a proveedores de IA externos; `false` por defecto. */
export const aiConsentSchema = z.strictObject({
  externalProviders: z.boolean(),
});
export type AiConsent = z.infer<typeof aiConsentSchema>;

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
 * `email` y `password`) invalida la petición.
 */
export const updateProfileRequestSchema = z
  .strictObject({
    displayName: displayNameSchema.optional(),
    aiConsent: aiConsentSchema.optional(),
    outputLanguage: outputLanguageSchema.optional(),
    redactName: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field is required',
  });
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
