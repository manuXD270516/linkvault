import { writeCvFixtures } from '../../apps/worker/src/modules/cv/infrastructure/extractors/fixtures/cv-fixtures.ts';

// Escribe en disco los fixtures de la extracción de CV. Ver `README.md`.
//
//   node --experimental-strip-types tools/cv-fixtures/make-fixtures.ts <carpeta>
//
// **Los tests no pasan por aquí**: usan las funciones de
// `apps/worker/src/modules/cv/infrastructure/extractors/fixtures/cv-fixtures.ts` y trabajan con los bytes en memoria,
// así que en el repositorio no queda ningún binario que revisar en un PR. Este script solo sirve para abrir los
// archivos a mano cuando hace falta mirarlos con un visor de PDF o descomprimir el DOCX.
//
// Las funciones viven en el worker y no aquí por una razón prosaica: la regla de límites de módulos de Nx prohíbe que
// un proyecto importe por ruta relativa algo de fuera de él, y quien los necesita de verdad son sus tests.

const directory = process.argv[2];
if (directory === undefined) {
  process.stderr.write('usage: make-fixtures.ts <directory>\n');
  process.exit(1);
}

const written = await writeCvFixtures(directory);
process.stdout.write(`${written.join('\n')}\n`);
