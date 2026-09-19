// Normalización del texto de un comentario y de la nota de quien comparte (D5 de group-comments, ADR-026 §5). Se
// normaliza, pero no se reescribe: los emails, teléfonos, enlaces y lo que parezca HTML se quedan como los escribió el
// miembro, porque ese texto no va a una IA ni sale del grupo. Lo único que se quita es lo que nadie ve y puede engañar:
// los caracteres de control y los que cambian la dirección del texto, que permiten falsear el orden visual.
//
// Vive en `libs/shared` porque la usan el schema zod del contrato HTTP y el dominio de `links`, que vuelve a validar.

/** Máximo de code points de un comentario tras normalizar. */
export const COMMENT_TEXT_MAX_LENGTH = 500;

/** Máximo de code points de la nota de quien comparte tras normalizar: es una línea de tarjeta, no un párrafo. */
export const SHARE_NOTE_MAX_LENGTH = 280;

/**
 * Caracteres de control (C0 salvo `\n`, DEL y C1) y de formato de dirección (U+202A–U+202E, U+2066–U+2069). DEL (U+007F)
 * no es C0 ni C1, pero es de la misma categoría Unicode (`Cc`) y tampoco se ve.
 */
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

/**
 * Texto de un comentario o de una nota listo para medir y guardar:
 * 1. `\r\n` y `\r` pasan a `\n`;
 * 2. se quitan los caracteres de control salvo `\n` y los de dirección del texto;
 * 3. se quitan los espacios y saltos exteriores.
 *
 * Es idempotente: normalizar dos veces da lo mismo que una.
 */
export function normalizeCommentText(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(INVISIBLE, '').trim();
}

/** Longitud en code points, el mismo criterio que zod 4 y que el dominio. */
export function commentTextLength(text: string): number {
  return [...text].length;
}
