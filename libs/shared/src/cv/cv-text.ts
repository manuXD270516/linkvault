import { CV_TEXT_MAX_CHARS, CV_TEXT_PREVIEW_CHARS } from './cv-limits';

// Normalización y recorte del texto extraído de un CV (D8 y D6 de cv-upload-extract, ADR-028 §7). Son funciones puras
// porque las usan dos procesos: el worker al guardar lo que leyó y la API al devolver la vista previa.
//
// Todo se mide en **code points**, no en unidades UTF-16, porque es lo que mide `$strLenCP` en Mongo y lo que corta
// `$substrCP`: la invariante `textChars === $strLenCP(extractedText)` solo se sostiene si las dos capas cuentan igual.

/** Caracteres de control salvo `\n` y `\t`, que sí significan algo en un CV. */
// eslint-disable-next-line no-control-regex -- la clase es literalmente la de los caracteres de control.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export interface PreparedCvText {
  /** Texto listo para guardar, ya normalizado y recortado. */
  readonly text: string;
  /** Code points guardados. Es lo que va a `extraction.textChars`. */
  readonly chars: number;
  /** `true` si hubo que recortar. Se guarda **solo en Mongo**: no sale en ninguna respuesta (D1). */
  readonly truncated: boolean;
}

/**
 * Texto tal y como se guarda: `\r\n` y `\r` pasan a `\n`, se quitan los caracteres de control salvo `\n` y `\t`, se
 * colapsan las líneas en blanco repetidas y se recortan los extremos. El tope de `CV_TEXT_MAX_CHARS` existe para que
 * un PDF generado con basura no meta megabytes de texto en un documento de Mongo.
 */
export function prepareCvText(raw: string): PreparedCvText {
  const normalized = raw
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const codePoints = [...normalized];
  if (codePoints.length <= CV_TEXT_MAX_CHARS) {
    return { text: normalized, chars: codePoints.length, truncated: false };
  }
  const text = codePoints.slice(0, CV_TEXT_MAX_CHARS).join('');
  return { text, chars: CV_TEXT_MAX_CHARS, truncated: true };
}

export interface CvTextPreview {
  /** Prefijo que se devuelve; cadena vacía si no hay texto que enseñar. */
  readonly text: string;
  /** Code points devueltos. */
  readonly chars: number;
}

/**
 * Los primeros `CV_TEXT_PREVIEW_CHARS` code points del texto, cortados en el último salto de línea o espacio anterior
 * al límite para no partir una palabra por la mitad.
 *
 * **`complete` no se calcula aquí**, y no es un olvido: esta función solo ve un prefijo, y un texto de exactamente
 * 2.000 caracteres y uno de 50.000 dan el mismo trozo. Lo calcula el repositorio, que mide el texto guardado con
 * `$strLenCP` en la misma consulta (D6, tarea 4.9). Por eso la consulta pide `CV_TEXT_PREVIEW_CHARS + 1`: es lo que
 * permite a esta función saber si había más y cortar en límite de palabra.
 */
export function cvTextPreview(text: string): CvTextPreview {
  const codePoints = [...text];
  if (codePoints.length <= CV_TEXT_PREVIEW_CHARS) {
    return { text, chars: codePoints.length };
  }
  const head = codePoints.slice(0, CV_TEXT_PREVIEW_CHARS).join('');
  const boundary = Math.max(head.lastIndexOf('\n'), head.lastIndexOf(' '));
  const cut = boundary > 0 ? head.slice(0, boundary) : head;
  return { text: cut, chars: [...cut].length };
}
