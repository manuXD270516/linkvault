import { existsSync, readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { type CatalogComparison, compareCatalogs } from '../src/locale/i18n-catalog';

// Último paso de `nx run web:i18n-check` (D2 de i18n-catalog-gate, ADR-050): compara la extracción que el target acaba de
// escribir en `tmp/i18n-check` con el catálogo versionado. Se ejecuta con `node --import tsx` desde la raíz del repo, como
// CommonJS: rutas desde `process.cwd()` y salida por `process.stdout`/`stderr`.

const EXTRACTED = 'tmp/i18n-check/messages.xlf';
const COMMITTED = 'apps/web/src/locale/messages.xlf';
const PREFIX = '[web:i18n-check]';

function main(): number {
  if (!existsSync(EXTRACTED)) {
    process.stderr.write(`${PREFIX} ${EXTRACTED} not found: the extraction did not run, so nothing was checked.\n`);
    return 1;
  }

  const parser = new new JSDOM('').window.DOMParser();
  const comparison = compareCatalogs(parser, readFileSync(EXTRACTED, 'utf8'), readFileSync(COMMITTED, 'utf8'));
  if (comparison.equal) {
    process.stdout.write(`${PREFIX} ${COMMITTED} is the output of the extraction.\n`);
    return 0;
  }

  process.stderr.write(`${PREFIX} ${COMMITTED} is not the output of the extraction.\n${explain(comparison)}`);
  process.stderr.write('Fix: pnpm nx run web:extract-i18n (never edit messages.xlf by hand, ADR-050).\n');
  return 1;
}

function explain(comparison: Exclude<CatalogComparison, { equal: true }>): string {
  if (comparison.unparseable) {
    return '  One of the catalogs is not valid XML: the difference cannot be classified.\n';
  }

  const lines = [
    list('New units (add their translation to messages.en.xlf)', comparison.added),
    list('Removed units (remove them from messages.en.xlf)', comparison.removed),
    list('Units whose Spanish text changed (review their translation in messages.en.xlf)', comparison.changed),
  ].filter((line) => line !== '');

  return lines.length > 0
    ? lines.join('')
    : '  No unit changes: the same units with the same text; only location, order or formatting differ.\n';
}

function list(title: string, ids: readonly string[]): string {
  return ids.length === 0 ? '' : `  ${title}:\n${ids.map((id) => `    - ${id}\n`).join('')}`;
}

try {
  process.exitCode = main();
} catch (error: unknown) {
  process.stderr.write(
    `${PREFIX} Unexpected error: ${error instanceof Error ? `${error.name}: ${error.message}` : 'unknown'}\n`,
  );
  process.exitCode = 1;
}
