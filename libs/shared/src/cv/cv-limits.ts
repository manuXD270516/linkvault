// Topes del CV (D3 de cv-upload-extract, ADR-028 §3). **Única definición**: el dominio de `api` y el del `worker` los
// importan de aquí y no los repiten, igual que `links/domain/public-slug.ts` importa el alfabeto del slug. Un número
// repetido en dos capas acaba diciendo dos cosas —el SPA anunciaría 5 CV mientras la API acepta 6— y la que se olvida
// de cambiar no falla, solo miente.
//
// Son constantes del contrato y no configuración: un tope que cada entorno puede mover es un tope que el SPA no puede
// anunciar y que los tests no pueden fijar.

/** Tamaño máximo del archivo subido: 5 MiB (design.md §4.8). Superarlo responde `413 file_too_large`. */
export const CV_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** CV guardados a la vez por persona. El siguiente recibe `409 too_many_cvs`: nada se borra solo (D3). */
export const MAX_CV_DOCUMENTS = 5;

/**
 * Tope del texto guardado en Mongo. Es entre diez y veinte veces cualquier CV real y existe para que un PDF generado
 * con basura no meta megabytes de texto en un documento (el límite de 16 MB de Mongo se alcanza antes de lo que
 * parece). Lo que sobra se recorta y se marca `truncated` **solo en la base**.
 */
export const CV_TEXT_MAX_CHARS = 200_000;

/** Texto útil mínimo tras normalizar para dar la extracción por buena; por debajo, `failed` con `no_text` (D8). */
export const CV_MIN_TEXT_CHARS = 100;

/** Caracteres que devuelve `GET /api/cv/:id/text-preview` (D6): para comprobar que la lectura sirve, no para leerlo. */
export const CV_TEXT_PREVIEW_CHARS = 2000;
