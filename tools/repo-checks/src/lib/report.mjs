/**
 * Salida común de las comprobaciones de repositorio.
 *
 * Sin `console` (regla del workspace): todo sale por `process.stdout` / `process.stderr`.
 * Una comprobación que pasa escribe **una** línea con lo que miró y cuántas cosas miró; una que falla escribe una
 * línea por hallazgo, cada una nombrando el fichero y el sujeto (variable, servicio…), y termina con código 1.
 */

/** @param {string} name @param {string} summary */
export function pass(name, summary) {
  process.stdout.write(`check(${name}): OK — ${summary}\n`);
}

/**
 * @param {string} name
 * @param {readonly string[]} findings
 * @param {string} [hint] qué hay que hacer para arreglarlo
 * @returns {never}
 */
export function fail(name, findings, hint) {
  process.stderr.write(
    `check(${name}): FALLA — ${findings.length} hallazgo(s)\n`,
  );
  for (const finding of findings) {
    process.stderr.write(`  - ${finding}\n`);
  }
  if (hint) {
    process.stderr.write(`  → ${hint}\n`);
  }
  process.exit(1);
}
