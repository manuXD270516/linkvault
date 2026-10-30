import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { CV_MAX_PDF_PAGES, CV_MAX_RAW_TEXT_CHARS } from '../extraction-limits';
import type { ChildExtraction } from './extraction-result';

// Lectura del PDF dentro del hijo (D3 de cv-extract-isolation). `pdf-parse` 1.1.4 (pdf.js 1.10.100 embebido) se queda;
// la costura por la que `cv-pdf-library-upgrade` enchufará la biblioteca nueva es `PdfTextSource`, y el runner del hijo
// no sabe cuál hay detrás.
//
// Se importa el **módulo interno** (`pdf-parse/lib/pdf-parse.js`) como `require` de literal: salta el código de
// depuración del `index.js` y webpack y el generador de `package.json` de Nx lo ven.

export interface PdfTextRead {
  readonly text: string;
  /** Hubo más páginas que `CV_MAX_PDF_PAGES`. */
  readonly pagesCapped: boolean;
  /** Se dejó de acumular al llegar a `CV_MAX_RAW_TEXT_CHARS`. */
  readonly rawCapped: boolean;
}

export interface PdfTextSource {
  read(bytes: Uint8Array): Promise<PdfTextRead>;
}

/**
 * Copia los bytes a una vista con **desplazamiento cero**: `pdf-parse` lee mal un búfer que viene del *pool* de Node
 * (`byteOffset` distinto de cero) e interpreta desplazadas las posiciones de la tabla `xref` (ADR-028). Los bytes que
 * llegan por `stdin` se juntan con `Buffer.concat`, que puede devolver justo uno así.
 */
export function withOwnBuffer(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

class PdfParseTextSource implements PdfTextSource {
  async read(bytes: Uint8Array): Promise<PdfTextRead> {
    let accumulated = 0;
    let rawCapped = false;
    const parsed = await pdfParse(withOwnBuffer(bytes), {
      // `max` acota las páginas: las demás ni se abren.
      max: CV_MAX_PDF_PAGES,
      // Mismo cuerpo que el `render_page` de `pdf-parse` (la unión por coordenada Y no cambia el texto guardado), con
      // el tope de texto crudo: al llegar a él no se vuelve a pedir `getTextContent`.
      pagerender: async (page) => {
        if (accumulated >= CV_MAX_RAW_TEXT_CHARS) {
          rawCapped = true;
          return '';
        }
        const content = await page.getTextContent({
          normalizeWhitespace: false,
          disableCombineTextItems: false,
        });
        let lastY: number | undefined;
        let text = '';
        for (const item of content.items) {
          const y = item.transform[5];
          if (lastY === y || !lastY) {
            text += item.str;
          } else {
            text += `\n${item.str}`;
          }
          lastY = y;
          if (accumulated + text.length >= CV_MAX_RAW_TEXT_CHARS) {
            rawCapped = true;
            break;
          }
        }
        accumulated += text.length;
        return text;
      },
    });
    const text =
      parsed.text.length > CV_MAX_RAW_TEXT_CHARS
        ? parsed.text.slice(0, CV_MAX_RAW_TEXT_CHARS)
        : parsed.text;
    return {
      text,
      pagesCapped: parsed.numpages > CV_MAX_PDF_PAGES,
      rawCapped: rawCapped || parsed.text.length > CV_MAX_RAW_TEXT_CHARS,
    };
  }
}

export const defaultPdfTextSource: PdfTextSource = new PdfParseTextSource();

/** `pdf.js` lanza `PasswordException` para un archivo que pide contraseña. */
function isPasswordError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'PasswordException'
  );
}

export async function extractPdf(
  bytes: Uint8Array,
  source: PdfTextSource = defaultPdfTextSource,
): Promise<ChildExtraction> {
  try {
    const read = await source.read(bytes);
    return { kind: 'text', ...read };
  } catch (error) {
    // Nunca se propaga el mensaje: puede llevar trozos del documento.
    return {
      kind: 'failed',
      cause: isPasswordError(error) ? 'password' : 'parse_error',
    };
  }
}
