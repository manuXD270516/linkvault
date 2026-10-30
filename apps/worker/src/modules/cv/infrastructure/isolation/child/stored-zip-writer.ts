import { crc32 } from 'node:zlib';
import type { InflatedEntry } from './docx-budgeted-unzip';

// Compone un ZIP **sin compresión** (`stored`) con las entradas ya infladas (D4 §5): así `jszip`, dentro de `mammoth`,
// ya no infla nada. Es el mismo formato que el de los fixtures de ADR-028.

const encoder = new TextEncoder();

export function composeStoredZip(
  entries: readonly InflatedEntry[],
): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const content = entry.content;
    const checksum = crc32(content);
    const local = new Uint8Array(30 + name.byteLength + content.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // nombres en UTF-8
    localView.setUint16(8, 0, true);
    localView.setUint16(12, 0x21, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, content.byteLength, true);
    localView.setUint32(22, content.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(content, 30 + name.byteLength);
    locals.push(local);

    const header = new Uint8Array(46 + name.byteLength);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true);
    headerView.setUint16(4, 20, true);
    headerView.setUint16(6, 20, true);
    headerView.setUint16(8, 0x0800, true);
    headerView.setUint16(14, 0x21, true);
    headerView.setUint32(16, checksum, true);
    headerView.setUint32(20, content.byteLength, true);
    headerView.setUint32(24, content.byteLength, true);
    headerView.setUint16(28, name.byteLength, true);
    headerView.setUint32(42, offset, true);
    header.set(name, 46);
    central.push(header);
    offset += local.byteLength;
  }
  const centralSize = central.reduce(
    (total, part) => total + part.byteLength,
    0,
  );
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const parts = [...locals, ...central, end];
  const out = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
  );
  let position = 0;
  for (const part of parts) {
    out.set(part, position);
    position += part.byteLength;
  }
  return out;
}
