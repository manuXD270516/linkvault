import { inflateRawSync } from 'node:zlib';
import { CV_DOCX_MAX_INFLATED_BYTES } from '../extraction-limits';
import type { ZipEntryInfo } from './docx-central-directory';
import { ZipRejection } from './zip-rejection';

// Inflado con presupuesto propio (D4 §4 de cv-extract-isolation). Se cuenta lo que **sale** del inflado, no lo que la
// cabecera declara: una cabecera que miente no sirve de nada. Las entradas `stored` cuentan su tamaño contra el mismo
// presupuesto. Agotarlo es `input_budget`.

export interface InflatedEntry {
  readonly name: string;
  readonly content: Uint8Array;
}

/** Imágenes que `extractRawText` no necesita: no se inflan. */
function isSkippable(name: string): boolean {
  return name.startsWith('word/media/');
}

export function inflateWithinBudget(
  zip: Uint8Array,
  entries: readonly ZipEntryInfo[],
  budget: number = CV_DOCX_MAX_INFLATED_BYTES,
): InflatedEntry[] {
  let remaining = budget;
  const inflated: InflatedEntry[] = [];
  for (const entry of entries) {
    if (isSkippable(entry.name)) {
      continue;
    }
    const raw = zip.subarray(
      entry.dataStart,
      entry.dataStart + entry.compressedSize,
    );
    let content: Uint8Array;
    if (entry.method === 0) {
      if (raw.byteLength > remaining) {
        throw new ZipRejection('input_budget');
      }
      content = raw;
    } else {
      try {
        // `maxOutputLength` mínimo es 1; con el presupuesto agotado, cualquier byte producido supera `remaining`.
        content = inflateRawSync(raw, {
          maxOutputLength: Math.max(remaining, 1),
        });
      } catch (error) {
        if (isBufferTooLarge(error)) {
          throw new ZipRejection('input_budget');
        }
        throw new ZipRejection('parse_error');
      }
      if (content.byteLength > remaining) {
        throw new ZipRejection('input_budget');
      }
    }
    remaining -= content.byteLength;
    inflated.push({ name: entry.name, content });
  }
  return inflated;
}

function isBufferTooLarge(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_BUFFER_TOO_LARGE'
  );
}
