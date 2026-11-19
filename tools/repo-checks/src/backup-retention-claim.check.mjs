/**
 * Comprobación: el plazo máximo de los datos borrados en las copias es el mismo en los tres sitios donde se escribe (ADR-066,
 * design D7, C32 y T-2; tarea 8.6 de `staging-backups`).
 *
 * El plazo (retención + poda + ventana de protección + papelera) se escribe en SEMANAS en:
 *   1. `infra/backup/README.md`: la línea marcada con `<!-- plazo-maximo -->`;
 *   2. `docs/RUNBOOK.md`: **todas** las líneas marcadas con `<!-- plazo-maximo -->` (el aviso a los invitados y la sección de
 *      operación);
 *   3. `apps/web/src/locale/messages.xlf`: el `source` de la unidad `privacy.backups.retention` (lo que dice `/privacidad`).
 * Si el número difiere entre ellos, o falta en alguno, falla nombrando los ficheros y los números. El aviso a los invitados de
 * 35b (su 9.10) no entra aquí: no es de este change, y lo comprueba la tarea 12.1 antes de fusionar.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_ROOT } from './lib/compose.mjs';
import { fail, pass } from './lib/report.mjs';

const NAME = 'backup-retention-claim';
const MARK = '<!-- plazo-maximo -->';

const read = (relative) => readFileSync(join(WORKSPACE_ROOT, relative), 'utf8');
const weeksIn = (text) =>
  [...text.matchAll(/(\d+)\s+semanas/g)].map((match) => Number(match[1]));

const findings = [];
/** @type {{ site: string, weeks: number }[]} */
const found = [];

/**
 * Las líneas de un `.md` se parten a 120 columnas: la marca puede quedar en una línea y el número en la siguiente. Se lee, desde
 * cada marca, la ventana de ese párrafo (la línea marcada y las tres siguientes) y se toma el PRIMER «N semanas» que aparezca.
 */
function fromMarkedLines(relative) {
  const all = read(relative).split(/\r?\n/);
  const marked = all
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.includes(MARK));
  if (marked.length === 0) {
    findings.push(`${relative}: no tiene ninguna línea marcada con ${MARK}`);
    return;
  }
  for (const { index } of marked) {
    const window = all.slice(index, index + 4).join(' ');
    const weeks = weeksIn(window);
    if (weeks.length === 0) {
      findings.push(
        `${relative}:${index + 1}: la línea marcada no dice cuántas semanas`,
      );
      continue;
    }
    found.push({ site: `${relative}:${index + 1}`, weeks: weeks[0] });
  }
}

fromMarkedLines('infra/backup/README.md');
fromMarkedLines('docs/RUNBOOK.md');

const catalog = 'apps/web/src/locale/messages.xlf';
const unit = read(catalog).match(
  /<trans-unit id="privacy\.backups\.retention"[^>]*>\s*<source>([\s\S]*?)<\/source>/,
);
if (unit === null) {
  findings.push(`${catalog}: no encuentro la unidad privacy.backups.retention`);
} else {
  const weeks = weeksIn(unit[1]);
  if (weeks.length === 0) {
    findings.push(
      `${catalog}: la unidad privacy.backups.retention no dice cuántas semanas`,
    );
  }
  for (const value of weeks)
    found.push({
      site: `${catalog} (privacy.backups.retention)`,
      weeks: value,
    });
}

const distinct = [...new Set(found.map((entry) => entry.weeks))];
if (distinct.length > 1) {
  findings.push(
    `el plazo máximo no es el mismo: ${found.map((entry) => `${entry.site} dice ${entry.weeks} semanas`).join('; ')}`,
  );
}

if (findings.length > 0) {
  fail(
    NAME,
    findings,
    'el número de semanas de infra/backup/README.md, docs/RUNBOOK.md y /privacidad se cambia a la vez (design D7)',
  );
}
pass(
  NAME,
  `${found.length} apariciones del plazo máximo en 3 sitios, todas ${distinct[0]} semanas`,
);
