import type { CvFileType } from '@linkvault/shared';

// Puerto de los extractores de texto (D8 y D9 de cv-upload-extract). Uno por formato, detrás de un token: `pdf-parse`
// y `mammoth` solo pueden importarse desde `infrastructure/`, y el lint de capas lo comprueba.

export const CV_TEXT_EXTRACTORS = Symbol('CV_TEXT_EXTRACTORS');

/** Lo que devuelve un extractor: el texto crudo, o que no pudo abrir el archivo. */
export type ExtractionAttempt =
  | { readonly kind: 'text'; readonly text: string }
  /**
   * El parser no pudo abrirlo: corrupto, protegido con contraseña, o un contenedor que no es el documento que decía
   * ser. **No es un error del job**: es un resultado con su motivo.
   */
  | { readonly kind: 'unreadable_file' };

export interface CvTextExtractor {
  /** Nunca lanza por culpa del archivo: cualquier excepción del parser se traduce a `unreadable_file`. */
  extract(bytes: Uint8Array): Promise<ExtractionAttempt>;
}

/** Los extractores por formato. Que la tabla los cubra todos lo garantiza el tipo. */
export type CvTextExtractors = Readonly<Record<CvFileType, CvTextExtractor>>;
