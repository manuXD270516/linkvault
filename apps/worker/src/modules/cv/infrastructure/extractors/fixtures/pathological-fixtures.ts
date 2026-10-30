import { once } from 'node:events';
import { createDeflateRaw, crc32, deflateSync } from 'node:zlib';
import { docxWithText, FIXTURE_CV_LINES } from './cv-fixtures';

// Archivos **patológicos generados en el test** (D10 de cv-extract-isolation). Nada de esto se commitea como binario ni
// como muestra: cada función construye los bytes al vuelo con `node:zlib` y los generadores grandes trabajan **por
// streaming** (H11), sin materializar cien mebibytes en el proceso del test.
//
// Regla de tamaño: ningún archivo generado supera el tope de 5 MiB de subida (lo que no podría llegar por la API no
// prueba nada) y cada prueba que los usa dura menos de 5 s.

const encoder = new TextEncoder();

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------------------------------------------------

interface BinaryPdfObject {
  readonly body: string;
  /** Contenido binario del stream, si lo lleva (`/Length` lo pone el ensamblador). */
  readonly stream?: Uint8Array;
}

/** Ensambla un PDF con su tabla `xref` (cada entrada ocupa 20 bytes; ver `cv-fixtures.ts`). Admite streams binarios. */
function assembleBinaryPdf(objects: readonly BinaryPdfObject[]): Uint8Array {
  const parts: Uint8Array[] = [encoder.encode('%PDF-1.4\n')];
  const offsets: number[] = [];
  let offset = parts[0]?.byteLength ?? 0;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const chunk =
      object.stream === undefined
        ? encoder.encode(`${index + 1} 0 obj\n${object.body}\nendobj\n`)
        : concat([
            encoder.encode(`${index + 1} 0 obj\n${object.body}\nstream\n`),
            object.stream,
            encoder.encode('\nendstream\nendobj\n'),
          ]);
    parts.push(chunk);
    offset += chunk.byteLength;
  });
  const entries = [
    '0000000000 65535 f \r\n',
    ...offsets.map(
      (value) => `${String(value).padStart(10, '0')} 00000 n \r\n`,
    ),
  ].join('');
  parts.push(
    encoder.encode(
      `xref\n0 ${objects.length + 1}\n${entries}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`,
    ),
  );
  return concat(parts);
}

const FONT = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

/** PDF de `count` páginas; la página `n` lleva la marca `PAGE-<n>`. */
export function pdfWithPageMarks(count: number): Uint8Array {
  // Objetos: 1 catálogo, 2 páginas, 3 fuente, y por página n: (4 + 2n) la página y (5 + 2n) su contenido.
  const kids = Array.from({ length: count }, (_, i) => `${4 + 2 * i} 0 R`);
  const objects: BinaryPdfObject[] = [
    { body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { body: `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${count} >>` },
    { body: FONT },
  ];
  for (let page = 1; page <= count; page += 1) {
    const pageObject = 4 + 2 * (page - 1);
    objects.push({
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObject + 1} 0 R >>`,
    });
    const content = `BT\n/F1 12 Tf\n72 720 Td\n(PAGE-${page}) Tj\nET`;
    objects.push({
      body: `<< /Length ${content.length} >>`,
      stream: encoder.encode(content),
    });
  }
  return assembleBinaryPdf(objects);
}

/**
 * PDF de una página cuyo content stream, deflactado, pinta más de `targetChars` caracteres de texto. Cada línea es un
 * bloque distinto de letras, para que la normalización posterior no lo reduzca.
 */
export function pdfWithEndlessText(targetChars = 1_600_000): Uint8Array {
  const lineChars = 100;
  const lines = Math.ceil(targetChars / lineChars);
  const rows: string[] = ['BT', '/F1 8 Tf', '9 TL', '10 780 Td'];
  for (let i = 0; i < lines; i += 1) {
    const word = `w${i.toString(36)}`;
    rows.push(
      `(${word.repeat(Math.ceil(lineChars / word.length)).slice(0, lineChars)}) Tj T*`,
    );
  }
  rows.push('ET');
  return assembleBinaryPdf([
    { body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    },
    { body: FONT },
    deflatedStreamObject(rows.join('\n')),
  ]);
}

function deflatedStreamObject(content: string): BinaryPdfObject {
  const data = new Uint8Array(deflateSync(encoder.encode(content)));
  return {
    body: `<< /Length ${data.byteLength} /Filter /FlateDecode >>`,
    stream: data,
  };
}

/** PDF con un array anidado `depth` niveles en el catálogo. */
export function pdfWithDeepNesting(depth = 100_000): Uint8Array {
  const nested = `${'['.repeat(depth)}${']'.repeat(depth)}`;
  return assembleBinaryPdf([
    { body: `<< /Type /Catalog /Pages 2 0 R /Deep ${nested} >>` },
    { body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    },
    { body: FONT },
    {
      body: '<< /Length 30 >>',
      stream: encoder.encode('BT /F1 12 Tf 72 720 Td (hola) Tj ET'),
    },
  ]);
}

// ---------------------------------------------------------------------------------------------------------------------
// ZIP / DOCX
// ---------------------------------------------------------------------------------------------------------------------

/** Una entrada ya comprimida (o almacenada), con los tamaños que el directorio central va a **declarar**. */
export interface RawZipEntry {
  readonly name: string;
  readonly method: 0 | 8;
  readonly data: Uint8Array;
  readonly crc: number;
  /** Tamaño original real. */
  readonly size: number;
  /** Tamaño original que declaran las cabeceras (puede mentir). */
  readonly declaredSize?: number;
}

/** Ensambla un ZIP con las entradas dadas, sin tocar nada de lo que declaran. */
export function assembleZip(entries: readonly RawZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const declared = entry.declaredSize ?? entry.size;
    const local = new Uint8Array(30 + name.byteLength + entry.data.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, entry.method, true);
    localView.setUint16(12, 0x21, true);
    localView.setUint32(14, entry.crc, true);
    localView.setUint32(18, entry.data.byteLength, true);
    localView.setUint32(22, declared, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(entry.data, 30 + name.byteLength);
    locals.push(local);

    const header = new Uint8Array(46 + name.byteLength);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true);
    headerView.setUint16(4, 20, true);
    headerView.setUint16(6, 20, true);
    headerView.setUint16(10, entry.method, true);
    headerView.setUint16(14, 0x21, true);
    headerView.setUint32(16, entry.crc, true);
    headerView.setUint32(20, entry.data.byteLength, true);
    headerView.setUint32(24, declared, true);
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
  return concat([...locals, ...central, end]);
}

/** Entrada `stored`. */
export function storedEntry(name: string, content: string): RawZipEntry {
  const data = encoder.encode(content);
  return { name, method: 0, data, crc: crc32(data), size: data.byteLength };
}

/**
 * Deflacta `repeats` veces `chunk` **por streaming**: nunca existen en memoria los `chunk.length * repeats` bytes.
 * Devuelve el flujo comprimido, su `crc32` y el tamaño original.
 */
export async function deflateRepeated(
  chunk: Uint8Array,
  repeats: number,
): Promise<{ data: Uint8Array; crc: number; size: number }> {
  const deflate = createDeflateRaw();
  const parts: Buffer[] = [];
  deflate.on('data', (part: Buffer) => parts.push(part));
  const finished = once(deflate, 'end');
  let crc = 0;
  for (let i = 0; i < repeats; i += 1) {
    crc = crc32(chunk, crc);
    if (!deflate.write(chunk)) {
      await once(deflate, 'drain');
    }
  }
  deflate.end();
  await finished;
  return {
    data: new Uint8Array(Buffer.concat(parts)),
    crc,
    size: chunk.byteLength * repeats,
  };
}

const MIB = 1024 * 1024;

/** Entradas mínimas de un DOCX, para que las pruebas de topes tengan un contenedor plausible. */
function docxSkeleton(): RawZipEntry[] {
  return [
    storedEntry(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    storedEntry(
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
  ];
}

/**
 * DOCX cuyo `word/document.xml` infla a `inflatedMiB` MiB de espacios. `declaredSize` es lo que dicen las cabeceras:
 * con un valor chico, la cabecera miente.
 */
export async function bombDocx(
  inflatedMiB = 100,
  declaredSize?: number,
): Promise<Uint8Array> {
  const spaces = new Uint8Array(MIB).fill(0x20);
  const bomb = await deflateRepeated(spaces, inflatedMiB);
  return assembleZip([
    ...docxSkeleton(),
    {
      name: 'word/document.xml',
      method: 8,
      data: bomb.data,
      crc: bomb.crc,
      size: bomb.size,
      ...(declaredSize !== undefined ? { declaredSize } : {}),
    },
  ]);
}

/** Dos entradas de `eachMiB` MiB cada una: el presupuesto se cuenta en total, no por entrada. */
export async function twoLargeEntriesDocx(eachMiB = 40): Promise<Uint8Array> {
  const spaces = new Uint8Array(MIB).fill(0x20);
  const first = await deflateRepeated(spaces, eachMiB);
  return assembleZip([
    ...docxSkeleton(),
    { name: 'word/a.xml', method: 8, ...first },
    { name: 'word/b.xml', method: 8, ...first },
  ]);
}

/** ZIP con `count` entradas vacías. */
export function zipWithEntries(count: number): Uint8Array {
  return assembleZip(
    Array.from({ length: count }, (_, i) => storedEntry(`e${i}.txt`, '')),
  );
}

/** ZIP64 de verdad: el directorio central satura el recuento de entradas. */
export function realZip64(): Uint8Array {
  const zip = new Uint8Array(docxWithText());
  const view = new DataView(zip.buffer);
  for (let offset = zip.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      view.setUint16(offset + 8, 0xffff, true);
      view.setUint16(offset + 10, 0xffff, true);
      return zip;
    }
  }
  throw new Error('fixture: no end of central directory');
}

/** DOCX con entidades XML anidadas en `word/document.xml`. */
export function docxWithNestedEntities(levels = 9, fanout = 10): Uint8Array {
  const declarations: string[] = ['<!ENTITY e0 "ha">'];
  for (let level = 1; level < levels; level += 1) {
    declarations.push(
      `<!ENTITY e${level} "${`&e${level - 1};`.repeat(fanout)}">`,
    );
  }
  const xml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><!DOCTYPE w:document [${declarations.join('')}]>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${FIXTURE_CV_LINES[0] ?? ''} &e${levels - 1};</w:t></w:r></w:p></w:body></w:document>`;
  return assembleZip([
    ...docxSkeleton(),
    storedEntry('word/document.xml', xml),
  ]);
}
