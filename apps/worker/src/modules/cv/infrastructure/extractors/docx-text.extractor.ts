import mammoth from 'mammoth';
import type {
  CvTextExtractor,
  ExtractionAttempt,
} from '../../application/ports/cv-text-extractors.port';

// Extractor de DOCX sobre `mammoth` (D8 de cv-upload-extract). Es la **segunda puerta** del residuo aceptado de D2:
// `PK\x03\x04` identifica un ZIP, no un DOCX, así que un `.xlsx` renombrado o un ZIP cualquiera pasan la puerta de la
// API —que no descomprime nada a propósito, para no abrir un archivo hostil en el proceso que atiende el tráfico— y
// mueren aquí con `unreadable_file`, el mismo desenlace que un DOCX corrupto.

export class DocxTextExtractor implements CvTextExtractor {
  async extract(bytes: Uint8Array): Promise<ExtractionAttempt> {
    try {
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(bytes),
      });
      return { kind: 'text', text: result.value };
    } catch {
      // Igual que el de PDF: cualquier excepción es un resultado, no un error del job, y no se registra su mensaje.
      return { kind: 'unreadable_file' };
    }
  }
}
