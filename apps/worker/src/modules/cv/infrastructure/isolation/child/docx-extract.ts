import mammoth from 'mammoth';
import { CV_MAX_RAW_TEXT_CHARS } from '../extraction-limits';
import { inflateWithinBudget } from './docx-budgeted-unzip';
import { readZipEntries } from './docx-central-directory';
import type { ChildExtraction } from './extraction-result';
import { composeStoredZip } from './stored-zip-writer';
import { ZipRejection } from './zip-rejection';

// Lectura del DOCX dentro del hijo (D4 de cv-extract-isolation): directorio central validado, inflado con
// presupuesto, ZIP `stored` recompuesto y `mammoth.extractRawText`. Cualquier excepción es un desenlace con causa de la
// lista cerrada, **nunca** con el mensaje de la excepción.

export async function extractDocx(bytes: Uint8Array): Promise<ChildExtraction> {
  try {
    const entries = readZipEntries(bytes);
    const inflated = inflateWithinBudget(bytes, entries);
    const stored = composeStoredZip(inflated);
    const result = await mammoth.extractRawText({
      buffer: Buffer.from(stored),
    });
    const rawCapped = result.value.length > CV_MAX_RAW_TEXT_CHARS;
    return {
      kind: 'text',
      text: rawCapped
        ? result.value.slice(0, CV_MAX_RAW_TEXT_CHARS)
        : result.value,
      pagesCapped: false,
      rawCapped,
    };
  } catch (error) {
    if (error instanceof ZipRejection) {
      return { kind: 'failed', cause: error.failure };
    }
    return { kind: 'failed', cause: 'parse_error' };
  }
}
