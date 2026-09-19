import { z } from 'zod';
import type { ApiErrorCode } from './auth.schema';
import { IMPORT_TEXT_MAX_LENGTH } from './link.schema';

// Contrato de `POST /api/links/:id/pasted` (paste-job-description). A diferencia de la importación, el límite de
// longitud **sí** se juzga aquí: el pipe valida antes que el caso de uso (D5), y un texto pasado de largo tiene que
// responder `text_too_long` antes de mirar siquiera si quien pega puede ver el link.
//
// El texto nunca se guarda ni se registra (D1): este schema solo lo deja pasar a la memoria de la petición.

/**
 * Clave de `params` con la que un issue de zod pide un código de error propio en vez del `validation_error` genérico.
 * El pipe de validación de `api` la lee; un issue sin ella sigue siendo `validation_error`.
 */
export const API_ERROR_CODE_ISSUE_PARAM = 'apiErrorCode';

/**
 * Longitud máxima del texto pegado, medida tras quitarle los espacios exteriores. Es la misma que la de la importación,
 * y responde el mismo código, `text_too_long`: para quien lo recibe es lo mismo, "has pegado demasiado".
 */
export const PASTED_TEXT_MAX_LENGTH = IMPORT_TEXT_MAX_LENGTH;

/**
 * Título o empresa escritos aparte en el diálogo de pegado. Son opcionales: el SPA solo los envía si la persona los
 * cambió respecto a lo que la tarjeta ya tenía. Cuando llegan, no son cadenas vacías, igual que en el preview.
 */
const pastedHeaderFieldSchema = z.string().trim().min(1).optional();

/**
 * Cuerpo de `POST /api/links/:id/pasted`: el texto de la oferta tal como la persona la copió y, si los escribió aparte,
 * su título y su empresa. Un texto vacío o de solo espacios es `validation_error`; uno de más de 20 000 caracteres,
 * `text_too_long`.
 */
export const pastedDescriptionRequestSchema = z.strictObject({
  text: z
    .string()
    .trim()
    .min(1)
    .refine((text) => text.length <= PASTED_TEXT_MAX_LENGTH, {
      params: {
        [API_ERROR_CODE_ISSUE_PARAM]: 'text_too_long' satisfies ApiErrorCode,
      },
    }),
  title: pastedHeaderFieldSchema,
  company: pastedHeaderFieldSchema,
});
export type PastedDescriptionRequest = z.infer<
  typeof pastedDescriptionRequestSchema
>;
