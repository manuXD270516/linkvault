import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_ROOT } from './compose.mjs';

/**
 * Lee las variables de primer nivel de un esquema zod de configuración (`z.object({ … })`) **del texto fuente**, sin
 * compilar TypeScript ni importar la app.
 *
 * Criterio de "obligatoria", el mismo del inventario del change: la propiedad no lleva `.default(` ni `.optional(`
 * en su bloque. Lo que decide el `superRefine` **no** se lee aquí: es TypeScript arbitrario y no se puede analizar
 * con una expresión regular sin fingir una cobertura que no se tiene. Las condicionales van **declaradas** en la
 * comprobación que usa esta función.
 *
 * Si el fichero deja de tener la forma que esto sabe leer, la función **lanza** en vez de devolver una lista corta:
 * una lista vacía o a medias pasaría en verde sin comprobar nada, que es el fallo que este change persigue.
 */
export function readSchemaVariables(relativePath, canaries) {
  const absolute = join(WORKSPACE_ROOT, relativePath);
  const lines = readFileSync(absolute, 'utf8').split('\n');

  const start = lines.findIndex((line) => /^\s*\.object\(\{\s*$/.test(line));
  if (start === -1) {
    throw new Error(
      `${relativePath}: no se encuentra el '.object({' del esquema; la comprobación del compose no puede leerlo`,
    );
  }
  let end = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}\}\)/.test(lines[index])) {
      end = index;
      break;
    }
  }
  if (end === -1) {
    throw new Error(
      `${relativePath}: no se encuentra el cierre del objeto del esquema`,
    );
  }

  const starts = [];
  for (let index = start + 1; index < end; index += 1) {
    const match = /^ {4}([A-Z][A-Z0-9_]*):/.exec(lines[index]);
    if (match) {
      starts.push({ name: match[1], line: index });
    }
  }
  if (starts.length === 0) {
    throw new Error(
      `${relativePath}: el esquema no declara ninguna variable reconocible; revisa la forma del fichero`,
    );
  }

  const variables = starts.map((property, position) => {
    const blockEnd = starts[position + 1]?.line ?? end;
    const block = lines.slice(property.line, blockEnd).join('\n');
    const optional = /\.default\(/.test(block) || /\.optional\(/.test(block);
    return { name: property.name, required: !optional };
  });

  const names = new Set(variables.map((variable) => variable.name));
  const missingCanaries = canaries.filter((canary) => !names.has(canary));
  if (missingCanaries.length > 0) {
    throw new Error(
      `${relativePath}: la lectura del esquema perdió variables que tienen que estar (${missingCanaries.join(', ')}); no se puede confiar en el resultado`,
    );
  }

  return variables;
}
