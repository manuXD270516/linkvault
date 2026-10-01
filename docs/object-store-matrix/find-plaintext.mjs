// Lectura del disco de C5 (tarea 2.9 de `object-store`, design D2, paso 3): busca en el `tar` del volumen del almacén
// **tres ventanas de 64 bytes de cada buffer** del modo C5 de la suite de contrato de `api` (A1, A2, B1, B2), en
// desplazamientos distintos (principio, mitad y final), e informa de **cada buffer por separado** (`A1 0/3`,
// `B1 3/3`…); y busca **la clave** en cada una de sus formas (textual, tal como va en el fichero de entorno; su contenido
// codificado; y los bytes decodificados). Se usa `node` y no `grep`: el proxy de la shell altera la salida de `grep`.
//
// Uso, desde la raíz del repositorio:
//
//   C5_KEY_TEXT=<clave> node docs/object-store-matrix/find-plaintext.mjs <vol.tar> <dir> [--json <salida.json>]
//
// `<dir>` es el de `S3_CONTRACT_C5_DIR` (`A1.bin`, `A2.bin`, `B1.bin`, `B2.bin`). La clave va por el entorno y no por la
// línea de órdenes, para que no quede en la lista de procesos; sin `C5_KEY_TEXT` no se busca clave. La salida nunca
// imprime la clave ni los bytes buscados. Lee el `tar` en trozos, con solape, sin cargarlo entero.
//
// Códigos: 0 búsqueda hecha (lo que haya encontrado lo interpreta `c5.sh`); 2 uso o ficheros ausentes.

import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { keyForms } from './c5-key.mjs';

const WINDOW = 64;
const NAMES = ['A1', 'A2', 'B1', 'B2'];

function fail(message) {
  process.stderr.write(`find-plaintext: ${message}\n`);
  process.exit(2);
}

const args = process.argv.slice(2);
let jsonOut;
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--json') {
    jsonOut = args[i + 1];
    i += 1;
  } else {
    positional.push(args[i]);
  }
}
if (positional.length !== 2 || (jsonOut !== undefined && jsonOut === '')) {
  fail('usage: C5_KEY_TEXT=<key> node find-plaintext.mjs <vol.tar> <dir> [--json <out.json>]');
}
const [tarPath, dir] = positional;
if (!existsSync(tarPath)) {
  fail(`${tarPath} does not exist`);
}

/** Tres desplazamientos distintos: principio, mitad y final del buffer. */
function offsetsOf(length) {
  return [0, Math.floor((length - WINDOW) / 2), length - WINDOW];
}

const patterns = [];
const buffers = {};
for (const name of NAMES) {
  const file = join(dir, `${name}.bin`);
  if (!existsSync(file)) {
    fail(`${file} does not exist (run the C5 mode of the contract suite first)`);
  }
  const bytes = readFileSync(file);
  if (bytes.length < 3 * WINDOW) {
    fail(`${file} is too small (${bytes.length} bytes)`);
  }
  const offsets = offsetsOf(bytes.length);
  if (new Set(offsets).size !== offsets.length) {
    fail(`${file}: the three windows are not at distinct offsets`);
  }
  buffers[name] = { bytes: bytes.length, offsets };
  for (const offset of offsets) {
    patterns.push({ owner: name, label: `${offset}`, bytes: bytes.subarray(offset, offset + WINDOW), found: false });
  }
}

const keyText = process.env.C5_KEY_TEXT;
const keyPatterns = [];
if (keyText !== undefined && keyText !== '') {
  for (const form of keyForms(keyText)) {
    const pattern = { owner: 'clave', label: form.label, bytes: form.bytes, found: false };
    keyPatterns.push(pattern);
    patterns.push(pattern);
  }
}

const longest = Math.max(...patterns.map((p) => p.bytes.length));
let tail = Buffer.alloc(0);
let scanned = 0;
for await (const chunk of createReadStream(tarPath, { highWaterMark: 8 * 1024 * 1024 })) {
  const window = tail.length === 0 ? chunk : Buffer.concat([tail, chunk]);
  for (const pattern of patterns) {
    if (!pattern.found && window.indexOf(pattern.bytes) >= 0) {
      pattern.found = true;
    }
  }
  scanned += chunk.length;
  tail = window.subarray(Math.max(0, window.length - (longest - 1)));
}

const result = {
  tar: basename(tarPath),
  tarBytes: statSync(tarPath).size,
  scannedBytes: scanned,
  buffers: {},
  key: keyPatterns.length === 0 ? null : {},
};
process.stdout.write(`find-plaintext: ${result.tar}, ${result.tarBytes} bytes leídos\n`);
for (const name of NAMES) {
  const own = patterns.filter((p) => p.owner === name);
  const found = own.filter((p) => p.found).length;
  result.buffers[name] = { found, of: own.length, bytes: buffers[name].bytes, offsets: buffers[name].offsets };
  process.stdout.write(
    `${name} ${found}/${own.length}  (${buffers[name].bytes} bytes; ventanas de ${WINDOW} bytes en ${buffers[name].offsets.join(', ')})\n`,
  );
}
if (keyPatterns.length === 0) {
  process.stdout.write('clave: no buscada (sin C5_KEY_TEXT)\n');
} else {
  const found = keyPatterns.filter((p) => p.found).length;
  for (const pattern of keyPatterns) {
    result.key[pattern.label] = pattern.found;
  }
  process.stdout.write(
    `clave ${found}/${keyPatterns.length}  (${keyPatterns.map((p) => `${p.label} ${p.found ? 'ENCONTRADA' : 'no'}`).join('; ')})\n`,
  );
}
if (jsonOut !== undefined) {
  writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
}
