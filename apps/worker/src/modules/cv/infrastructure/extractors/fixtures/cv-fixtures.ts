import { crc32 } from 'node:zlib';

// Fixtures de la extracción de CV (D9 de cv-upload-extract, ADR-028 "Pruebas"). Se **generan**, no se commitean, y no
// añaden ninguna dependencia: un PDF mínimo es texto plano con su tabla de referencias cruzadas, y un DOCX es un ZIP
// sin comprimir, que `node:zlib` sabe firmar con su `crc32`.
//
// **Ningún fixture lleva datos personales.** El texto es el de un CV inventado, con un nombre que no existe: ningún CV
// real entra en este repositorio, ni siquiera en un test.
//
// La excepción es el **PDF cifrado**, que sí está commiteado y no sale de aquí: ver `README.md`.

const encoder = new TextEncoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

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

/** Texto del CV inventado que llevan los fixtures con capa de texto. Más de 100 caracteres, que es el mínimo útil. */
export const FIXTURE_CV_LINES: readonly string[] = [
  'Nadia Quispe Almaraz - Ingeniera de software',
  'Experiencia: tres anios construyendo servicios en Node y TypeScript.',
  'Herramientas: MongoDB, Redis, Docker y colas de trabajo.',
  'Idiomas: espaniol nativo, ingles tecnico.',
];

/**
 * Objeto PDF numerado. Cada uno se escribe entero y se apunta su desplazamiento, que es lo que la tabla `xref`
 * necesita: si un desplazamiento se desvia un byte, el archivo deja de abrirse.
 */
interface PdfObject {
  readonly body: string;
  /** Contenido del stream, si el objeto lo lleva. */
  readonly stream?: string;
}

/**
 * Ensambla un PDF a partir de sus objetos.
 *
 * Cada entrada de la tabla `xref` ocupa **exactamente 20 bytes**: diez dígitos de desplazamiento, un espacio, cinco de
 * generación, un espacio, el tipo, y **espacio + CR + LF** como final de línea. Ese final importa de verdad: con un
 * `\n` a secas la entrada sigue midiendo 20 bytes y `pdf-parse` rechaza el archivo igualmente.
 */
function assemblePdf(
  objects: readonly PdfObject[],
  trailerExtras = '',
): Uint8Array {
  const parts: Uint8Array[] = [bytes('%PDF-1.4\n')];
  const offsets: number[] = [];
  let offset = parts[0]?.byteLength ?? 0;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const head = `${index + 1} 0 obj\n${object.body}\n`;
    const chunk =
      object.stream === undefined
        ? bytes(`${head}endobj\n`)
        : bytes(`${head}stream\n${object.stream}\nendstream\nendobj\n`);
    parts.push(chunk);
    offset += chunk.byteLength;
  });
  const xrefOffset = offset;
  const entries = [
    '0000000000 65535 f \r\n',
    ...offsets.map(
      (value) => `${String(value).padStart(10, '0')} 00000 n \r\n`,
    ),
  ].join('');
  parts.push(
    bytes(
      `xref\n0 ${objects.length + 1}\n${entries}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailerExtras} >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    ),
  );
  return concat(parts);
}

/** PDF de una página con capa de texto, el que tiene que terminar en `extracted`. */
export function pdfWithText(
  lines: readonly string[] = FIXTURE_CV_LINES,
): Uint8Array {
  const content = [
    'BT',
    '/F1 12 Tf',
    '14 TL',
    '72 720 Td',
    ...lines.map((line) => `(${escapePdfText(line)}) Tj T*`),
    'ET',
  ].join('\n');
  return assemblePdf([
    { body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    },
    { body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    { body: `<< /Length ${content.length} >>`, stream: content },
  ]);
}

/** PDF de una página **sin capa de texto**: lo que da un escaneo. Se abre bien y no hay nada que leer. */
export function pdfWithoutText(): Uint8Array {
  // Un rectángulo gris: contenido de página legítimo, cero operadores de texto.
  const content = '0.5 g\n72 600 200 100 re\nf';
  return assemblePdf([
    { body: '<< /Type /Catalog /Pages 2 0 R >>' },
    { body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    {
      body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    },
    { body: `<< /Length ${content.length} >>`, stream: content },
  ]);
}

/** Cadena hexadecimal determinista de 32 bytes, para los campos del diccionario de cifrado. */
function hex32(seed: number): string {
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    out += ((seed + i * 7) % 256).toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * PDF **protegido con contraseña**: lleva su diccionario de cifrado estándar (`/Filter /Standard`, `/V 1 /R 2`) y su
 * `/ID`, así que el parser toma el camino del descifrado y se planta pidiendo la contraseña que nadie le va a dar.
 * Desde fuera es exactamente el caso de la persona que sube el CV que mandó protegido a una empresa.
 *
 * **Por qué se genera y no se commitea** (desviación anotada de D9): el diseño lo produce una vez con
 * `qpdf --encrypt` y lo guarda como binario, para no escribir un cifrador solo para un test. Aquí no se escribe
 * ninguno tampoco —el diccionario es la declaración, no el cifrado—, y generarlo evita meter en el repositorio un
 * binario que nadie puede revisar en un PR. El comando equivalente está en `README.md`, para el día que haga falta un
 * archivo cifrado de verdad.
 */
export function encryptedPdf(): Uint8Array {
  const content =
    'BT\n/F1 12 Tf\n72 720 Td\n(contenido cifrado inventado para la prueba) Tj\nET';
  return assemblePdf(
    [
      { body: '<< /Type /Catalog /Pages 2 0 R >>' },
      { body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
      {
        body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      },
      { body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
      { body: `<< /Length ${content.length} >>`, stream: content },
      {
        body: `<< /Filter /Standard /V 1 /R 2 /O <${hex32(3)}> /U <${hex32(97)}> /P -44 >>`,
      },
    ],
    ` /Encrypt 6 0 R /ID [<${hex32(11)}> <${hex32(11)}>]`,
  );
}

/** PDF que empieza por su firma y sigue con basura: el parser no puede abrirlo. */
export function corruptPdf(): Uint8Array {
  const junk = new Uint8Array(512);
  for (let i = 0; i < junk.length; i += 1) {
    // Determinista a propósito: un fixture que cambia entre ejecuciones es un test que falla los martes.
    junk[i] = (i * 37 + 11) % 256;
  }
  return concat([bytes('%PDF-1.4\n'), junk]);
}

/** DOCX mínimo: un ZIP **sin comprimir** con las tres entradas que `mammoth` necesita. */
export function docxWithText(
  lines: readonly string[] = FIXTURE_CV_LINES,
): Uint8Array {
  const paragraphs = lines
    .map((line) => `<w:p><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`)
    .join('');
  return zipOf([
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'word/document.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${paragraphs}</w:body>` +
        '</w:document>',
    },
  ]);
}

/** ZIP que **no** es un DOCX: pasa la puerta de la API (`PK\x03\x04`) y muere en la extracción. */
export function zipThatIsNotDocx(): Uint8Array {
  return zipOf([
    { name: 'hola.txt', content: 'esto no es un documento de Word' },
  ]);
}

interface ZipEntry {
  readonly name: string;
  readonly content: string;
}

/**
 * ZIP con todas sus entradas **almacenadas** (método 0), que es lo que permite escribirlo sin comprimir nada: el único
 * cálculo que hace falta es el `crc32`, y `node:zlib` lo trae.
 */
function zipOf(entries: readonly ZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = bytes(entry.name);
    const content = bytes(entry.content);
    const checksum = crc32(Buffer.from(content));
    const local = new Uint8Array(30 + name.byteLength + content.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true); // versión mínima
    localView.setUint16(6, 0, true); // sin banderas
    localView.setUint16(8, 0, true); // método 0: almacenado
    localView.setUint16(10, 0, true); // hora
    localView.setUint16(12, 0x21, true); // fecha fija: un fixture no cambia entre ejecuciones
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, content.byteLength, true);
    localView.setUint32(22, content.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(content, 30 + name.byteLength);
    locals.push(local);

    const header = new Uint8Array(46 + name.byteLength);
    const headerView = new DataView(header.buffer);
    headerView.setUint32(0, 0x02014b50, true);
    headerView.setUint16(4, 20, true);
    headerView.setUint16(6, 20, true);
    headerView.setUint16(8, 0, true);
    headerView.setUint16(10, 0, true);
    headerView.setUint16(12, 0, true);
    headerView.setUint16(14, 0x21, true);
    headerView.setUint32(16, checksum, true);
    headerView.setUint32(20, content.byteLength, true);
    headerView.setUint32(24, content.byteLength, true);
    headerView.setUint16(28, name.byteLength, true);
    headerView.setUint16(30, 0, true);
    headerView.setUint16(32, 0, true);
    headerView.setUint16(34, 0, true);
    headerView.setUint16(36, 0, true);
    headerView.setUint32(38, 0, true);
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

function escapePdfText(line: string): string {
  return line.replace(/([\\()])/g, '\\$1');
}

function escapeXml(line: string): string {
  return line
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Los fixtures, por nombre de archivo. Todos se generan: en el repositorio no queda ningún binario que revisar. */
export function generatedCvFixtures(): Readonly<Record<string, Uint8Array>> {
  return {
    'cv-with-text.pdf': pdfWithText(),
    'cv-without-text.pdf': pdfWithoutText(),
    'cv-corrupt.pdf': corruptPdf(),
    'cv-encrypted.pdf': encryptedPdf(),
    'cv-with-text.docx': docxWithText(),
    'not-a-docx.zip': zipThatIsNotDocx(),
  };
}

/**
 * Escribe los fixtures en una carpeta. Es lo que hace el script cuando se le llama como programa; los tests usan las
 * funciones de arriba directamente, porque lo que necesitan son bytes, no archivos.
 */
export async function writeCvFixtures(directory: string): Promise<string[]> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  await mkdir(directory, { recursive: true });
  const written: string[] = [];
  for (const [name, content] of Object.entries(generatedCvFixtures())) {
    const path = join(directory, name);
    await writeFile(path, content);
    written.push(path);
  }
  return written;
}
