import { CV_DOCX_MAX_ENTRIES } from '../extraction-limits';
import { ZipRejection } from './zip-rejection';

// Lector propio del directorio central de un ZIP (D4 §1-3 de cv-extract-isolation). `mammoth` y `jszip` se fían de lo
// que el archivo declara; aquí se valida **antes** de inflar nada.
//
// El directorio central es la fuente de verdad del **método** y del **tamaño comprimido** de cada entrada. Para
// **ubicar los datos** se valida además la cabecera local: firma, que el desplazamiento y las longitudes caigan dentro
// del archivo, y que nombre y método coincidan con los del directorio central.
//
// Causas: lo estructuralmente roto es `parse_error`; lo que viola un tope de D4 (demasiadas entradas, ZIP64 de verdad,
// método no admitido, nombre o desplazamiento peligrosos, cabecera local que miente) es `input_budget`; una entrada
// cifrada es `password`.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_LENGTH = 22;
const MAX_COMMENT_LENGTH = 0xffff;
const CENTRAL_FIXED_LENGTH = 46;
const LOCAL_FIXED_LENGTH = 30;

export type ZipMethod = 0 | 8;

export interface ZipEntryInfo {
  readonly name: string;
  readonly method: ZipMethod;
  readonly compressedSize: number;
  /** Tamaño que **declara** el archivo. No se usa para presupuestar: el presupuesto cuenta lo que sale del inflado. */
  readonly declaredSize: number;
  /** Desplazamiento del primer byte de datos, ya validada la cabecera local. */
  readonly dataStart: number;
}

function findEndOfCentralDirectory(view: DataView): number {
  const last = view.byteLength - EOCD_MIN_LENGTH;
  const first = Math.max(0, last - MAX_COMMENT_LENGTH);
  for (let offset = last; offset >= first; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new ZipRejection('parse_error');
}

function isUnsafeName(name: string): boolean {
  if (
    name.startsWith('/') ||
    name.startsWith('\\') ||
    /^[A-Za-z]:/.test(name)
  ) {
    return true;
  }
  return name.split(/[\\/]/).includes('..');
}

export function readZipEntries(zip: Uint8Array): ZipEntryInfo[] {
  if (zip.byteLength < EOCD_MIN_LENGTH) {
    throw new ZipRejection('parse_error');
  }
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = findEndOfCentralDirectory(view);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const totalEntries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);

  // ZIP64 de verdad: algún valor saturado. Un campo extra ZIP64 con valores de 32 bits no llega a esta comprobación.
  if (
    entriesOnDisk === 0xffff ||
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new ZipRejection('input_budget');
  }
  if (totalEntries > CV_DOCX_MAX_ENTRIES) {
    throw new ZipRejection('input_budget');
  }
  if (centralOffset + centralSize > eocd) {
    throw new ZipRejection('input_budget');
  }

  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntryInfo[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + CENTRAL_FIXED_LENGTH > eocd) {
      throw new ZipRejection('parse_error');
    }
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new ZipRejection('parse_error');
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const declaredSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nameStart = cursor + CENTRAL_FIXED_LENGTH;
    const next = nameStart + nameLength + extraLength + commentLength;
    if (next > eocd) {
      throw new ZipRejection('parse_error');
    }
    // Bit 0: cifrada; bit 6: cifrado fuerte.
    if ((flags & 0x1) !== 0 || (flags & 0x40) !== 0) {
      throw new ZipRejection('password');
    }
    if (method !== 0 && method !== 8) {
      throw new ZipRejection('input_budget');
    }
    if (
      compressedSize === 0xffffffff ||
      declaredSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      throw new ZipRejection('input_budget');
    }
    const nameBytes = zip.subarray(nameStart, nameStart + nameLength);
    const name = decoder.decode(nameBytes);
    if (isUnsafeName(name)) {
      throw new ZipRejection('input_budget');
    }

    // Cabecera local (D4 §2).
    if (localOffset + LOCAL_FIXED_LENGTH > zip.byteLength) {
      throw new ZipRejection('input_budget');
    }
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new ZipRejection('input_budget');
    }
    const localMethod = view.getUint16(localOffset + 8, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localNameStart = localOffset + LOCAL_FIXED_LENGTH;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    if (dataStart > zip.byteLength) {
      throw new ZipRejection('input_budget');
    }
    const localName = zip.subarray(
      localNameStart,
      localNameStart + localNameLength,
    );
    if (
      localMethod !== method ||
      localNameLength !== nameLength ||
      !sameBytes(localName, nameBytes)
    ) {
      throw new ZipRejection('input_budget');
    }
    if (dataStart + compressedSize > zip.byteLength) {
      throw new ZipRejection('input_budget');
    }

    entries.push({
      name,
      method: method === 0 ? 0 : 8,
      compressedSize,
      declaredSize,
      dataStart,
    });
    cursor = next;
  }
  return entries;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  for (let i = 0; i < left.byteLength; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}
