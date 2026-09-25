/**
 * Agregador de las comprobaciones de repositorio.
 *
 * Nx ya ha ejecutado, por `dependsOn`, todos los targets `check-*` cuando este script corre: si uno falla, la
 * ejecución se detiene y esto no llega a imprimirse. Lo que añade el agregador es el **guardia del conjunto vacío**:
 *
 *  1. falla si no queda ninguna comprobación declarada — un agregador vacío pasaría en verde sin mirar nada, que es
 *     exactamente la señal falsa que este change viene a erradicar;
 *  2. falla si algún target `check-*` del `project.json` **no** está en el `dependsOn` del agregador — una
 *     comprobación que nadie ejecuta es peor que no tenerla, porque figura escrita.
 *
 * La última línea que escribe (`repo-checks: N comprobaciones ejecutadas`) es la que leen los workflows para su
 * propio guardia: si el paso de CI no la encuentra, o el número es 0, el paso falla.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const projectFile = join(projectRoot, 'project.json');
const project = JSON.parse(readFileSync(projectFile, 'utf8'));

const targets = Object.keys(project.targets ?? {});
const checks = targets.filter((target) => target.startsWith('check-')).sort();
const dependsOn = project.targets?.check?.dependsOn ?? [];

const problems = [];
if (checks.length === 0) {
  problems.push(
    "tools/repo-checks/project.json no declara ningún target 'check-*': el agregador no comprobaría nada y pasaría en verde",
  );
}
for (const check of checks) {
  if (!dependsOn.includes(check)) {
    problems.push(
      `tools/repo-checks/project.json: el target '${check}' existe pero no está en 'check.dependsOn', así que el agregador no lo ejecuta`,
    );
  }
}

if (problems.length > 0) {
  process.stderr.write('repo-checks: FALLA el guardia del agregador\n');
  for (const problem of problems) {
    process.stderr.write(`  - ${problem}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `repo-checks: ${checks.length} comprobaciones ejecutadas (${checks.join(', ')})\n`,
);
