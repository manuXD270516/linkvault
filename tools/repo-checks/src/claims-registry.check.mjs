/**
 * Comprobación: ninguna entrada del **registro declarado** de `claims.registry.mjs` sigue afirmándose donde el
 * código la desmiente.
 *
 * Falla por **dos** lados, y los dos hacen falta:
 *
 *  1. **La afirmación sobrevive.** El patrón aparece en algún archivo del alcance y los símbolos que la desmienten
 *     existen. Es el defecto real: el RUNBOOK mandaba borrar a mano, con `mongosh`, lo que `DELETE /api/users/me`
 *     ya hace entero y en una transacción.
 *  2. **El símbolo desaparece.** Si el código que desmiente la afirmación deja de existir, la entrada **no** pasa en
 *     silencio: se señala para revisión. Una entrada cuyo símbolo se ha ido ya no comprueba nada, y dejarla en verde
 *     es exactamente la señal falsa que este change persigue (ADR-048 §7: una comprobación que no puede fallar no es
 *     una comprobación).
 *
 * Qué NO comprueba: si la prosa de alrededor es buena, ni nada fuera de las entradas del registro. Ver la cabecera
 * de `claims.registry.mjs`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CLAIMS_REGISTRY } from './claims.registry.mjs';
import { relativeToRoot, WORKSPACE_ROOT } from './lib/compose.mjs';
import { fail, pass } from './lib/report.mjs';

const NAME = 'claims-registry';

/** Directorios que nunca se leen, estén donde estén: no son fuente del repositorio. */
const NEVER_WALK = new Set(['node_modules', 'dist', 'coverage', '.git']);

/** @returns {string[]} rutas relativas a la raíz, con `/` como separador. */
function filesUnder(scope) {
  const found = [];
  for (const root of scope.roots) {
    walk(join(WORKSPACE_ROOT, root), found);
  }
  return found
    .map((absolute) => relativeToRoot(absolute))
    .filter(
      (path) =>
        scope.extensions.some((extension) => path.endsWith(extension)) &&
        !scope.excludePrefixes.some((prefix) => path.startsWith(prefix)),
    )
    .sort();
}

function walk(directory, found) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (NEVER_WALK.has(entry.name)) continue;
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, found);
    else if (entry.isFile()) found.push(absolute);
  }
}

/** Número de línea (1-based) del índice `at` dentro de `text`. */
function lineAt(text, at) {
  let line = 1;
  for (let i = 0; i < at; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

/**
 * Marcadores que abren la **continuación** de una línea y que no son parte de la frase: `//` y ` * ` de los
 * comentarios de TypeScript, `#` de los títulos y `>` de las citas de Markdown.
 */
const CONTINUATION_MARKER = /^(?:\/\/+|\/\*+|\*+\/?|#+|>+)[ \t]*/;

/**
 * Aplana el texto a **una sola línea** —sangrías, saltos y marcadores de continuación colapsados en un espacio—
 * conservando, para cada carácter, el índice que tenía en el original.
 *
 * Existe porque los dos sitios donde vivía la afirmación la partían de formas distintas, y `\s+` solo cubre una:
 *
 * - en `docs/RUNBOOK.md`, "Hoy no ⏎ existe el borrado de cuenta" — entre las dos mitades solo hay espacios;
 * - en `group.mapper.ts`, "hoy no existe el borrado ⏎ * de cuenta" — entre las dos mitades hay un ` * ` de JSDoc.
 *
 * Buscar con `\s+` encuentra la primera y **pierde la segunda**, que es justo el comentario por el que la
 * afirmación volvió después de corregirse una vez. Normalizar primero y buscar después las encuentra las dos.
 *
 * @returns {{ flat: string, indexOf: number[] }}
 */
function flatten(text) {
  const characters = [];
  const indexOf = [];
  let i = 0;
  let lineStart = true;
  let pendingSpace = false;
  while (i < text.length) {
    if (lineStart) {
      while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;
      const marker = CONTINUATION_MARKER.exec(text.slice(i, i + 16));
      if (marker !== null) i += marker[0].length;
      lineStart = false;
      continue;
    }
    const character = text[i];
    if (character === '\n' || character === '\r') {
      pendingSpace = characters.length > 0;
      lineStart = true;
      i += 1;
      continue;
    }
    if (character === ' ' || character === '\t') {
      pendingSpace = characters.length > 0;
      i += 1;
      continue;
    }
    if (pendingSpace) {
      characters.push(' ');
      indexOf.push(i);
      pendingSpace = false;
    }
    characters.push(character);
    indexOf.push(i);
    i += 1;
  }
  return { flat: characters.join(''), indexOf };
}

const findings = [];
let filesRead = 0;
let patternsApplied = 0;

for (const entry of CLAIMS_REGISTRY) {
  const missingSymbols = [];
  for (const symbol of entry.symbols) {
    let text;
    try {
      text = readFileSync(join(WORKSPACE_ROOT, symbol.file), 'utf8');
    } catch {
      missingSymbols.push(`${symbol.file} (no existe): ${symbol.what}`);
      continue;
    }
    if (!symbol.regex.test(text)) {
      missingSymbols.push(`${symbol.file}: ya no contiene ${symbol.what}`);
    }
  }

  if (missingSymbols.length > 0) {
    for (const missing of missingSymbols) {
      findings.push(
        `entrada '${entry.id}': REVISAR — el símbolo que desmiente la afirmación ya no está en ${missing}. Mientras falte, esta entrada no comprueba nada: o el símbolo se ha movido (actualiza el registro) o la afirmación ha vuelto a ser cierta (entonces la entrada sobra)`,
      );
    }
    // Sin símbolo no se puede afirmar que el texto mienta: la entrada queda en revisión y no se buscan patrones.
    continue;
  }

  for (const path of filesUnder(entry.scope)) {
    const text = readFileSync(join(WORKSPACE_ROOT, path), 'utf8');
    const { flat, indexOf } = flatten(text);
    filesRead += 1;
    for (const pattern of entry.patterns) {
      patternsApplied += 1;
      pattern.regex.lastIndex = 0;
      for (const match of flat.matchAll(pattern.regex)) {
        const original = indexOf[match.index ?? 0] ?? 0;
        findings.push(
          `${path}:${lineAt(text, original)}: entrada '${entry.id}' — el texto todavía afirma ${entry.claim}; lo desmiente ${entry.symbols.map((s) => s.what).join(', ')}. Patrón que casó: ${pattern.recognises}`,
        );
      }
    }
  }
}

if (findings.length > 0) {
  fail(
    NAME,
    findings,
    `para 'borrado-de-cuenta-no-existe': ${CLAIMS_REGISTRY[0].fix}. Si la frase se reescribió a propósito, actualiza el patrón en tools/repo-checks/src/claims.registry.mjs`,
  );
}

pass(
  NAME,
  `${CLAIMS_REGISTRY.length} entrada(s) del registro, ${patternsApplied} aplicaciones de patrón sobre ${filesRead} archivo(s) de docs/, apps/ y libs/ (docs/adr/ queda fuera: un ADR es historia y lleva nota fechada)`,
);
