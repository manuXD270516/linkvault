import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import type {
  CvTextExtractor,
  ExtractionAttempt,
} from '../../application/ports/cv-text-extractors.port';

// Extractor de PDF sobre `pdf-parse` (D9 de cv-upload-extract, ADR-028 "Dependencias").
//
// Se importa el **módulo interno** y no la raíz del paquete: el `index.js` de `pdf-parse` ejecuta un modo de
// depuración que intenta leer un PDF de ejemplo del propio paquete cuando cree que se le llama como programa, y en un
// bundle eso revienta con un `ENOENT` desconcertante.

/**
 * Copia los bytes a una vista con **desplazamiento cero**, y no es una precaución de manual.
 *
 * `pdf-parse` lee mal un búfer que viene del *pool* de Node: con `byteOffset` distinto de cero —lo normal en objetos
 * pequeños, porque Node los saca de un búfer compartido, y es justo lo que devuelve leer un objeto de MinIO— el parser
 * interpreta las posiciones de la tabla `xref` desplazadas y falla con `bad XRef entry`. El mismo PDF se abre sin
 * problema si el búfer empieza en cero. Se reprodujo por debajo de ~4 kB; por encima Node deja de usar el *pool* y el
 * fallo desaparece, que es lo que lo hace tan fácil de no ver.
 *
 * Sin esta copia, un CV pequeño y perfectamente legible acabaría en `failed` con `unreadable_file` y nadie sabría por
 * qué.
 */
export function withOwnBuffer(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

export class PdfTextExtractor implements CvTextExtractor {
  async extract(bytes: Uint8Array): Promise<ExtractionAttempt> {
    try {
      const parsed = await pdfParse(withOwnBuffer(bytes));
      return { kind: 'text', text: parsed.text };
    } catch {
      // **Cualquier** excepción es `unreadable_file`: corrupto, cifrado, o una versión del formato que este parser no
      // entiende. No se registra ni el nombre del error ni su mensaje, que puede llevar dentro trozos del documento.
      return { kind: 'unreadable_file' };
    }
  }
}
