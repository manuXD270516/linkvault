import { z } from 'zod';
import { CV_FILE_TYPE_VALUES } from '../cv/cv-file';

// Contratos HTTP del módulo `cv` (D1 y D6 de cv-upload-extract, ADR-028 §1 y §5).
//
// **El contrato es la primera de las tres barreras** que impiden que el CV se escape: `cvDocumentSchema` es un
// `strictObject` con exactamente los campos que pueden salir —sin `extractedText`, sin `truncated`, sin `fileKey` y
// sin `userId`—, el mapeo parte de una lista explícita de campos y nunca de un `...document`, y el repositorio proyecta
// fuera el texto en todas sus lecturas salvo la que lo escribe y la de la vista previa. El campo largo y libre es el
// que filtra, y esto ya se aprendió con `summary` en `public-preview-share`.

/** Estado de la lectura del CV. Lo ve su dueña en el listado y lo repite la vista previa. */
export const cvExtractionStatusSchema = z.enum([
  // Desde el `201` hasta que el worker escribe: "Estamos leyendo tu CV…".
  'pending',
  // Hay texto útil guardado (≥ `CV_MIN_TEXT_CHARS` tras normalizar).
  'extracted',
  // No hay texto, y `failureReason` dice por qué. Un `failed` no borra nada.
  'failed',
]);
export type CvExtractionStatus = z.infer<typeof cvExtractionStatusSchema>;

/** Por qué no hay texto. Los tres terminan en una acción distinta en la pantalla (D13). */
export const cvExtractionFailureReasonSchema = z.enum([
  // El extractor no pudo abrirlo: corrupto, protegido con contraseña, un ZIP que no es DOCX, o venció el plazo.
  'unreadable_file',
  // Se abrió, pero no hay texto útil: un escaneo, imágenes.
  'no_text',
  // Un fallo nuestro que agotó los reintentos. Nunca se queda en `pending` para siempre.
  'internal_error',
]);
export type CvExtractionFailureReason = z.infer<
  typeof cvExtractionFailureReasonSchema
>;

/**
 * Estado de la extracción tal y como sale por HTTP. `textChars` es lo que se guardó, y es lo que consume la vista
 * previa dentro del servidor; la marca de texto recortado **no está** a propósito: es un detalle de cómo guardamos, no
 * una noticia para quien subió el CV (D1).
 */
export const cvExtractionSchema = z
  .strictObject({
    status: cvExtractionStatusSchema,
    failureReason: cvExtractionFailureReasonSchema.optional(),
    textChars: z.number().int().min(0),
    extractedAt: z.iso.datetime().optional(),
  })
  .superRefine((extraction, ctx) => {
    // Un `failed` sin motivo sería un diagnóstico sin remedio: la pantalla no sabría qué acción ofrecer.
    if (extraction.status === 'failed' && extraction.failureReason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['failureReason'],
        message: 'A failed extraction must carry its reason',
      });
    }
    if (extraction.status !== 'failed' && extraction.failureReason !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['failureReason'],
        message: 'Only a failed extraction carries a reason',
      });
    }
  });
export type CvExtraction = z.infer<typeof cvExtractionSchema>;

/** Tipo del archivo, con la misma lista que decide el husmeo de los bytes. */
export const cvFileTypeSchema = z.enum(CV_FILE_TYPE_VALUES);

/**
 * Un CV guardado, tal y como lo devuelven el alta, el listado y el marcado por defecto. Estricto: cualquier campo de
 * más —`extractedText`, la marca de recorte, `fileKey`, `userId`— no valida, y ese fallo es el que avisa de que alguien
 * cambió un mapeo por un `...document`.
 */
export const cvDocumentSchema = z.strictObject({
  id: z.string().min(1),
  /** Nombre saneado tal y como lo subió su dueña; solo ella lo ve. */
  fileName: z.string().min(1),
  fileType: cvFileTypeSchema,
  sizeBytes: z.number().int().positive(),
  /** Correlativo por persona, nunca reutilizado. La pantalla no lo enseña: identifica por nombre y fecha (D13). */
  version: z.number().int().positive(),
  isDefault: z.boolean(),
  uploadedAt: z.iso.datetime(),
  extraction: cvExtractionSchema,
});
export type CvDocument = z.infer<typeof cvDocumentSchema>;

/** Respuesta del listado y de todo lo que devuelve la lista actualizada. Sin paginación: el máximo es 5. */
export const cvListResponseSchema = z.strictObject({
  items: z.array(cvDocumentSchema),
});
export type CvListResponse = z.infer<typeof cvListResponseSchema>;

/**
 * Respuesta de `GET /api/cv/:id/text-preview` (D6). `status` va en el cuerpo porque, sin él, un CV que todavía se está
 * leyendo y uno que no se pudo leer devuelven **exactamente la misma respuesta vacía**, y quien llama no puede
 * distinguirlos sin pedir además el listado; y como el objeto es estricto, añadirlo después sería romper el contrato.
 *
 * `complete` dice si con ese trozo ya está todo el texto guardado. Lo calcula el repositorio midiendo el texto en la
 * misma consulta, nunca leyendo `textChars`, que lo escribió otro proceso en otro momento.
 */
export const cvTextPreviewResponseSchema = z.strictObject({
  status: cvExtractionStatusSchema,
  /** Puede ser la cadena vacía: un CV en `pending` o en `failed` no tiene nada que enseñar. */
  text: z.string(),
  chars: z.number().int().min(0),
  complete: z.boolean(),
});
export type CvTextPreviewResponse = z.infer<
  typeof cvTextPreviewResponseSchema
>;
