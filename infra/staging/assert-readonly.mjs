#!/usr/bin/env node
// =====================================================================================================================
// Comprobación estática de solo lectura de un script `mongosh` de staging (design D15 de `staging-host`, tarea 9.12).
// =====================================================================================================================
// Uso, en la máquina del operador y desde la raíz del repositorio:
//
//   node infra/staging/assert-readonly.mjs <script.mongosh.js>
//
// Mongo de staging no tiene autenticación: no hay un usuario de rol `read` con el que ejecutar las consultas, y quien
// llega al contenedor `mongo` tiene acceso total. La garantía de que un script de medición no escribe es **esta
// comprobación**, y la aplica `infra/staging/run.sh` antes de abrir ninguna sesión: si sale ≠0, no se ejecuta nada.
//
// Falla (sale 1) nombrando cada aparición, con línea y columna, de:
//   - las operaciones de escritura de la lista de design D15: `insert*`, `update*`, `replace*`, `delete*`, `remove`,
//     `drop*`, `bulkWrite`, `findOneAnd*`, `findAndModify`, `create*`, `rename*`, `save`, `runCommand`,
//     `adminCommand` y las etapas `$out` y `$merge`. Se buscan en **todo** el texto, comentarios y cadenas incluidos
//     (falla cerrada: un comentario que nombre una de ellas también la hace fallar). Única excepción: los nombres de
//     campo `createdAt` y `updatedAt`, que empiezan como `create*`/`update*`, cuando no van seguidos de `(`;
//   - las vías más directas de llamar a una operación sin escribir su nombre: acceso calculado a un miembro
//     (`coleccion[expr]`), secuencias de escape `\u`/`\x`, `Reflect`, `eval(`, `Function(`, `load(`, `require(`,
//     `import(`, `mapReduce` (escribe con `out`) y los ayudantes `rs.` y `sh.` (reconfiguran el replica set).
//
// No es un analizador de JavaScript ni un entorno aislado: detecta lo que está escrito y cierra las indirecciones
// obvias, que es lo que protege de un error al editar un script. Contra quien quiera saltársela no protege, y no lo
// pretende: el operador ya tiene acceso total (RUNBOOK, «Paso 6 sexdecies — Operar staging»).
//
// Salida: 0 sin hallazgos; 1 con hallazgos (uno por línea en stderr); 2 por un error de uso o de lectura.
// =====================================================================================================================
import { readFileSync, statSync } from 'node:fs';

/** Lista de design D15, en su orden: `etiqueta` es como la nombra el design; `test` decide si un identificador casa. */
const WRITE_OPERATIONS = [
  { label: 'insert*', test: (name) => name.startsWith('insert') },
  { label: 'update*', test: (name) => name.startsWith('update') },
  { label: 'replace*', test: (name) => name.startsWith('replace') },
  { label: 'delete*', test: (name) => name.startsWith('delete') },
  { label: 'remove', test: (name) => name === 'remove' },
  { label: 'drop*', test: (name) => name.startsWith('drop') },
  { label: 'bulkWrite', test: (name) => name === 'bulkWrite' },
  { label: 'findOneAnd*', test: (name) => name.startsWith('findOneAnd') },
  { label: 'findAndModify', test: (name) => name === 'findAndModify' },
  { label: 'create*', test: (name) => name.startsWith('create') },
  { label: 'rename*', test: (name) => name.startsWith('rename') },
  { label: 'save', test: (name) => name === 'save' },
  { label: 'runCommand', test: (name) => name === 'runCommand' },
  { label: 'adminCommand', test: (name) => name === 'adminCommand' },
  { label: '$out', test: (name) => name === '$out' },
  { label: '$merge', test: (name) => name === '$merge' },
];

/** Campos de los esquemas que empiezan como una operación; solo se aceptan como nombre, nunca llamados. */
const FIELD_NAMES = new Set(['createdAt', 'updatedAt']);

/** Identificadores que dan una vía de ejecutar código o de llegar a un método por un nombre calculado. */
const ALWAYS_FORBIDDEN = new Set(['Reflect', 'mapReduce']);
const FORBIDDEN_CALLS = new Set([
  'eval',
  'Function',
  'load',
  'require',
  'import',
]);
const SHELL_HELPERS = new Set(['rs', 'sh']);

/** Palabras clave tras las que `[` abre un literal de array y no un acceso calculado. */
const KEYWORDS_BEFORE_ARRAY = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'case',
  'else',
  'do',
  'void',
  'yield',
  'await',
  'new',
  'throw',
  'const',
  'let',
  'var',
]);

const path = process.argv[2];
if (path === undefined || process.argv.length !== 3) {
  process.stderr.write(
    'usage: node infra/staging/assert-readonly.mjs <script.mongosh.js>\n',
  );
  process.exit(2);
}

let source;
try {
  if (!statSync(path).isFile()) {
    throw new Error('no es un fichero');
  }
  source = readFileSync(path, 'utf8');
} catch (error) {
  process.stderr.write(
    `assert-readonly: no se puede leer ${path}: ${error instanceof Error ? error.message : error}\n`,
  );
  process.exit(2);
}

const lineStarts = [0];
for (let i = 0; i < source.length; i += 1) {
  if (source[i] === '\n') {
    lineStarts.push(i + 1);
  }
}

function position(offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineStarts[mid] <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${low + 1}:${offset - lineStarts[low] + 1}`;
}

/** Siguiente carácter que no es espacio a partir de `offset`, o cadena vacía al final. */
function nextNonSpace(offset) {
  const match = /\S/.exec(source.slice(offset));
  return match === null ? '' : match[0];
}

const findings = [];
const report = (offset, message) => findings.push({ offset, message });

let identifiers = 0;
const identifierPattern = /[A-Za-z_$][\w$]*/g;
for (const match of source.matchAll(identifierPattern)) {
  identifiers += 1;
  const name = match[0];
  const start = match.index;
  const end = start + name.length;
  const following = nextNonSpace(end);

  const operation = WRITE_OPERATIONS.find((candidate) => candidate.test(name));
  if (
    operation !== undefined &&
    !(FIELD_NAMES.has(name) && following !== '(')
  ) {
    report(
      start,
      `operación de escritura «${name}» (${operation.label}, design D15)`,
    );
    continue;
  }
  if (ALWAYS_FORBIDDEN.has(name)) {
    report(start, `«${name}» no está permitido en un script de solo lectura`);
    continue;
  }
  if (FORBIDDEN_CALLS.has(name) && following === '(') {
    report(
      start,
      `llamada a «${name}(»: ejecuta código que esta comprobación no ve`,
    );
    continue;
  }
  if (
    SHELL_HELPERS.has(name) &&
    source[start - 1] !== '.' &&
    following === '.'
  ) {
    report(
      start,
      `ayudante «${name}.» de mongosh: administra el replica set o el sharding`,
    );
  }
}

for (const match of source.matchAll(/\\[ux]/g)) {
  report(
    match.index,
    `secuencia de escape «${match[0]}»: puede escribir un nombre sin que se vea`,
  );
}

for (const match of source.matchAll(/\[/g)) {
  const before = source.slice(0, match.index).replace(/\s+$/, '');
  const last = before.at(-1);
  if (last === undefined || !/[\w$)\]]/.test(last)) {
    continue;
  }
  const word = /[A-Za-z_$][\w$]*$/.exec(before);
  if (word !== null && KEYWORDS_BEFORE_ARRAY.has(word[0])) {
    continue;
  }
  report(
    match.index,
    'acceso calculado a un miembro «[…]»: puede llamar a una operación sin nombrarla',
  );
}

findings.sort((a, b) => a.offset - b.offset);
if (findings.length > 0) {
  for (const finding of findings) {
    process.stderr.write(
      `assert-readonly: ${path}:${position(finding.offset)}: ${finding.message}\n`,
    );
  }
  process.stderr.write(
    `assert-readonly: ${path}: ${findings.length} hallazgo(s); el script no es de solo lectura\n`,
  );
  process.exit(1);
}
process.stdout.write(
  `assert-readonly: ${path}: solo lectura (${identifiers} identificadores revisados)\n`,
);
