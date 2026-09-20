import { CV_FILE_TYPES, type CvFileType } from './cv-file';

// Saneado del nombre del archivo que se guarda y se enseña (D1 de cv-upload-extract, ADR-028 §1). El nombre se guarda
// porque es la única forma que tiene una persona de reconocer cuál de sus CV es cuál, y su listado solo lo ve ella.
//
// El riesgo de un nombre propio no es guardarlo junto al archivo que describe, sino **repetirlo donde no se espera**:
// una ruta, una cabecera, un registro. Por eso se le quitan las rutas, los caracteres de control, los de cambio de
// dirección del texto —que hacen que `CV_kcod.docx` se lea como un PDF— y las **comillas dobles, las barras
// invertidas y los `;`**, que son justo los que permiten partir una cabecera que lo lleve dentro. Ese último saneado
// se queda aunque la descarga esté fuera del change (decisión humana 1): lo que protege no es una cabecera concreta,
// sino cualquier sitio donde el nombre se pegue después.
//
// El nombre NO se usa para nada más: ni para la clave del objeto (`cvFileKey`), ni para decidir el tipo
// (`resolveCvFileType` solo mira su extensión).

/** Tope del nombre guardado, en code points. Se recorta conservando la extensión. */
export const CV_FILE_NAME_MAX_LENGTH = 120;

/** Controles C0 y C1, cambio de dirección del texto (U+202A–U+202E) y aislamientos direccionales (U+2066–U+2069). */
// eslint-disable-next-line no-control-regex -- la lista de caracteres prohibidos es literalmente de caracteres de control.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069"\\;]/g;

/**
 * Nombre seguro para guardar y mostrar. Si tras el saneado no queda nada legible, devuelve `cv.pdf` o `cv.docx` según
 * el tipo ya detectado por los bytes, que es lo único de lo que podemos fiarnos.
 */
export function safeCvFileName(name: string, type: CvFileType): string {
  const fallback = `cv${CV_FILE_TYPES[type].extension}`;
  const lastSegment = name.split(/[/\\]/).pop() ?? '';
  const cleaned = lastSegment.replace(FORBIDDEN, '').trim();
  if (cleaned === '') {
    return fallback;
  }
  const dot = cleaned.lastIndexOf('.');
  // `dot === 0` es un nombre que solo era su extensión (`.pdf`): no queda nada que reconocer, así que va el respaldo.
  const base = dot >= 0 ? cleaned.slice(0, dot) : cleaned;
  const extension = dot >= 0 ? cleaned.slice(dot) : '';
  if (base.trim() === '') {
    return fallback;
  }
  return truncate(base.trim(), extension);
}

/** Recorta el nombre a `CV_FILE_NAME_MAX_LENGTH` code points conservando su extensión. */
function truncate(base: string, extension: string): string {
  const baseChars = [...base];
  const extensionChars = [...extension];
  if (baseChars.length + extensionChars.length <= CV_FILE_NAME_MAX_LENGTH) {
    return `${base}${extension}`;
  }
  const room = CV_FILE_NAME_MAX_LENGTH - extensionChars.length;
  if (room <= 0) {
    // Una "extensión" más larga que el tope entero no es una extensión: se recorta el nombre completo.
    return [...base, ...extensionChars]
      .slice(0, CV_FILE_NAME_MAX_LENGTH)
      .join('');
  }
  return `${baseChars.slice(0, room).join('')}${extension}`;
}
