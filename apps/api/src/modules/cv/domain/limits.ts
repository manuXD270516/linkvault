import {
  CV_MAX_FILE_BYTES,
  CV_TEXT_PREVIEW_CHARS,
  MAX_CV_DOCUMENTS,
} from '@linkvault/shared';

// Límites del módulo `cv` (D3 y D5 de cv-upload-extract, ADR-028 §3 y §6).
//
// Los topes del **contrato** —tamaño del archivo, CV guardados, caracteres de la vista previa— se **importan** de
// `libs/shared` y no se repiten aquí, como `links/domain/public-slug.ts` hace con el alfabeto del slug: un número
// escrito en dos capas acaba diciendo dos cosas, y el SPA anunciaría 5 CV mientras la API acepta 6. Lo único que se
// declara aquí es lo que solo el servidor necesita: las ventanas de los contadores.

export { CV_MAX_FILE_BYTES, CV_TEXT_PREVIEW_CHARS, MAX_CV_DOCUMENTS };

/** Subidas aceptadas por persona y ventana. Falla **abierto**: sin contador, el tope real lo pone `MAX_CV_DOCUMENTS`. */
export const CV_UPLOADS_PER_USER = 10;

/**
 * Vistas previas por persona y ventana. También falla **abierto**, y por su propia razón: esa ruta solo lee lo suyo
 * —como mucho cinco documentos de una persona y un prefijo de 2.000 caracteres—, sin IA, sin red hacia fuera y sin
 * escrituras. Lo que se permite de más con Redis caído es que alguien mire su propio CV muchas veces; negárselo sería
 * impedirle comprobar si su CV sirve por una avería nuestra.
 */
export const CV_TEXT_PREVIEWS_PER_USER = 60;

/**
 * Archivos rechazados en la puerta por persona y ventana. Se cuenta **solo** al rechazar (`415` y `413`) y **nunca se
 * devuelve**: es lo que pone techo a una ráfaga de basura sin cobrarle una subida a quien se equivoca de archivo una
 * vez. Treinta rechazos en quince minutos no los hace nadie sin querer.
 */
export const CV_REJECTS_PER_USER = 30;

/** La misma ventana que `auth` y `links`, para no inventar una tercera unidad de tiempo. */
export const CV_LIMIT_WINDOW_MS = 15 * 60 * 1000;
