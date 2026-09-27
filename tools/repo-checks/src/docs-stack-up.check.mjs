/**
 * Comprobación: el `up` que `infra/README.md` documenta para levantar la pila a mano y el que ejecuta la
 * verificación del artefacto en CI (`infra/ci/verify-artifact.sh`) **no pueden divergir en silencio**.
 *
 * Por qué existe (tarea 12.3 del change `deploy-image-verification`). El CD demuestra en cada corrida que la pila de
 * `docker-compose.prod.yml` arranca, pero hasta ahora **no había ningún camino escrito para que una persona la
 * levantara**: lo único que se podía hacer era leer el YAML del workflow. El README documenta ahora ese camino, y un
 * camino documentado que nadie ejecuta se pudre — es exactamente la forma de mentira que ADR-048 persigue.
 *
 * "Seguir el procedimiento desde cero en una máquina limpia" no es comprobable en un PR, así que lo que se comprueba
 * es lo que sí se puede: que **el bloque documentado y el del script digan lo mismo** en las tres cosas que deciden
 * qué se levanta —fichero de compose, selección de servicios y flags (`--wait`, `--wait-timeout`, `--pull never`)—.
 *
 * Nota de alcance, porque el enunciado de la tarea suponía otra cosa: 12.3 planeaba comparar el bloque documentado
 * con **el del workflow**, cuando la verificación era código inline. El grupo 11 la movió a un script, así que
 * comparar contra el YAML ya no diría nada (el YAML solo invoca `infra/ci/verify-artifact.sh`). El par comparable es
 * README ↔ script.
 *
 * Qué NO comprueba, dicho en voz alta: que el procedimiento documentado **funcione**. Eso solo lo dice ejecutarlo, y
 * se ejecutó al escribirlo (salidas literales en el grupo 12 de `tasks.md`). Aquí solo se impide que las dos copias
 * se separen.
 *
 * Las órdenes `run` de después del `up` (design D5 del change `object-store`, ADR-052 §5). El almacén no se
 * aprovisiona en su healthcheck: tras el `up` van `run --rm --no-deps api node object-store.js provision` y después
 * `verify` (y la lectura del `worker`). Dos comprobaciones, porque una sola no basta:
 *   - **absoluta:** cada lado contiene, **después** de su `up`, `provision` y **después** `verify`. Comparar los dos
 *     lados entre sí no lo cubre: si alguien quita las dos órdenes **de los dos**, siguen siendo iguales;
 *   - **relativa:** las dos listas de órdenes `run` (desde `run` hasta el final de la orden) son las mismas y en el
 *     mismo orden.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_ROOT, relativeToRoot } from './lib/compose.mjs';
import { fail, pass } from './lib/report.mjs';

const NAME = 'docs-stack-up';

const README_PATH = join(WORKSPACE_ROOT, 'infra/README.md');
const SCRIPT_PATH = join(WORKSPACE_ROOT, 'infra/ci/verify-artifact.sh');
const README = relativeToRoot(README_PATH);
const SCRIPT = relativeToRoot(SCRIPT_PATH);

/** Marca del bloque documentado. Va en el README, justo encima de su fence. */
const SENTINEL = '<!-- repo-check: stack-up';

/** El env file de CI lleva escrito que no sirve para nada que no sea el corredor (tarea 5.3). */
const CI_ENV_FILE = 'infra/ci/verify.env';

/**
 * Las dos órdenes que la comprobación absoluta exige tras el `up`, en este orden (design D5 de `object-store`).
 * Se comparan desde `run` hasta el final de la orden, igual que las listas de la relativa.
 */
const PROVISION_RUN = 'run --rm --no-deps api node object-store.js provision';
const VERIFY_RUN = 'run --rm --no-deps api node object-store.js verify';

/** Lo que termina una orden dentro de una línea de shell. */
const COMMAND_END = new Set(['||', '&&', ';', '|']);

const findings = [];

/** Junta las continuaciones de línea (`\` al final) para poder leer un comando como un solo texto. */
function joinContinuations(text) {
  return text.replace(/\\\r?\n\s*/g, ' ');
}

function unquote(token) {
  const match = /^(['"])(.*)\1$/s.exec(token);
  return match ? match[2] : token;
}

/**
 * Parsea una invocación de `docker compose … up …` ya tokenizada.
 * @param {readonly string[]} tokens
 */
function parseUp(tokens) {
  const result = {
    composeFile: undefined,
    envFile: undefined,
    flags: new Set(),
    waitTimeout: undefined,
    services: [],
  };
  const upIndex = tokens.indexOf('up');
  if (upIndex === -1) {
    return undefined;
  }
  for (let i = 0; i < upIndex; i += 1) {
    if (tokens[i] === '-f' || tokens[i] === '--file') {
      result.composeFile = tokens[i + 1];
    }
    if (tokens[i] === '--env-file') {
      result.envFile = tokens[i + 1];
    }
  }
  for (let i = upIndex + 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--wait-timeout') {
      result.waitTimeout = tokens[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith('--wait-timeout=')) {
      result.waitTimeout = token.slice('--wait-timeout='.length);
      continue;
    }
    if (token === '--pull') {
      result.flags.add(`--pull ${tokens[i + 1]}`);
      i += 1;
      continue;
    }
    if (token.startsWith('--pull=')) {
      result.flags.add(`--pull ${token.slice('--pull='.length)}`);
      continue;
    }
    if (token.startsWith('-')) {
      result.flags.add(token);
      continue;
    }
    result.services.push(token);
  }
  return result;
}

/**
 * La orden `run` de una línea ya tokenizada: desde el token `run` que sigue a quien invoca Compose hasta el final de la
 * orden (`||`, `&&`, `;`, `|`, un comentario o el final de la línea). `undefined` si la línea no es un `run`.
 * @param {readonly string[]} tokens
 * @param {(tokens: readonly string[], index: number) => boolean} isInvoker `true` si `tokens[index]` invoca Compose
 */
function runCommand(tokens, isInvoker) {
  const invokerAt = tokens.findIndex((_, index) => isInvoker(tokens, index));
  if (invokerAt === -1) {
    return undefined;
  }
  const runAt = tokens.indexOf('run', invokerAt + 1);
  if (runAt === -1) {
    return undefined;
  }
  // Entre quien invoca y `run` solo caben opciones de Compose con su valor (`-f <f>`, `--env-file <e>`).
  for (let i = invokerAt + 1; i < runAt; i += 1) {
    if (!tokens[i].startsWith('-') && !tokens[i - 1].startsWith('-')) {
      return undefined;
    }
  }
  const command = [];
  for (const token of tokens.slice(runAt)) {
    if (COMMAND_END.has(token) || token.startsWith('#')) {
      break;
    }
    const bare = token.replace(/;$/, '');
    command.push(unquote(bare));
    if (bare !== token) {
      break;
    }
  }
  return command.join(' ');
}

/**
 * La comprobación absoluta sobre un lado: `provision` y después `verify` entre sus órdenes `run` de tras el `up`.
 * @param {string} file
 * @param {readonly string[]} runs
 */
function checkProvisionThenVerify(file, runs) {
  const provisionAt = runs.indexOf(PROVISION_RUN);
  const verifyAt = runs.indexOf(VERIFY_RUN);
  if (provisionAt === -1) {
    findings.push(
      `${file} no ejecuta, después de su 'up', '${PROVISION_RUN}': el almacén quedaría sin buckets ni cifrado del bucket de CV`,
    );
  }
  if (verifyAt === -1) {
    findings.push(
      `${file} no ejecuta, después de su 'up', '${VERIFY_RUN}': nada comprobaría el almacén que se entrega`,
    );
  }
  if (provisionAt !== -1 && verifyAt !== -1 && verifyAt < provisionAt) {
    findings.push(
      `${file} ejecuta 'verify' antes que 'provision': el orden es up → provision → verify`,
    );
  }
}

// --- Lado A: el bloque documentado en infra/README.md --------------------------------------------------------------
const readme = readFileSync(README_PATH, 'utf8');
const sentinelAt = readme.indexOf(SENTINEL);
if (sentinelAt === -1) {
  fail(
    NAME,
    [
      `${README} no lleva la marca '${SENTINEL} …' : sin ella no hay bloque documentado que comparar`,
    ],
    `escribe el procedimiento de arranque a mano en ${README} y márcalo con '${SENTINEL} -->' encima de su fence`,
  );
}

const fenceStart = readme.indexOf('```', sentinelAt);
const blockStart = fenceStart === -1 ? -1 : readme.indexOf('\n', fenceStart) + 1;
const fenceEnd = blockStart === -1 ? -1 : readme.indexOf('```', blockStart);
if (blockStart === -1 || fenceEnd === -1) {
  fail(
    NAME,
    [`${README}: la marca '${SENTINEL}' no va seguida de un bloque de código`],
    'la marca tiene que ir inmediatamente encima del fence con los comandos',
  );
}
const documentedBlock = readme.slice(blockStart, fenceEnd);

const documentedUpLine = joinContinuations(documentedBlock)
  .split(/\r?\n/)
  .find((line) => /docker compose\b/.test(line) && /\bup\b/.test(line));
if (documentedUpLine === undefined) {
  fail(
    NAME,
    [
      `${README}: el bloque marcado con '${SENTINEL}' no contiene ninguna orden 'docker compose … up …'`,
    ],
    'el bloque documentado tiene que traer el `up` completo, no una referencia a él',
  );
}
const documented = parseUp(
  documentedUpLine.trim().split(/\s+/).map(unquote),
);

/** En el README, Compose se invoca siempre como `docker compose`. */
function isDockerCompose(tokens, index) {
  return tokens[index] === 'compose' && tokens[index - 1] === 'docker';
}

// Las órdenes `run` documentadas **después** del `up`, cada una con su fichero de compose.
const documentedLines = joinContinuations(documentedBlock).split(/\r?\n/);
const documentedRuns = [];
const documentedRunFiles = [];
for (const line of documentedLines.slice(documentedLines.indexOf(documentedUpLine) + 1)) {
  if (line.trim().startsWith('#')) {
    continue;
  }
  const tokens = line.trim().split(/\s+/).map(unquote);
  const run = runCommand(tokens, isDockerCompose);
  if (run === undefined) {
    continue;
  }
  documentedRuns.push(run);
  const composeAt = tokens.findIndex((_, index) => isDockerCompose(tokens, index));
  const fileAt = tokens.findIndex((token, index) => index > composeAt && (token === '-f' || token === '--file'));
  documentedRunFiles.push(fileAt === -1 ? undefined : tokens[fileAt + 1]);
}

// --- Lado B: lo que ejecuta infra/ci/verify-artifact.sh -------------------------------------------------------------
const script = joinContinuations(readFileSync(SCRIPT_PATH, 'utf8'));

const composeFileMatch = /^COMPOSE_FILE=(.+)$/m.exec(script);
const envFileMatch = /^ENV_FILE=(.+)$/m.exec(script);
const servicesMatch = /^SERVICES=\(([^)]*)\)/m.exec(script);
const waitTimeoutMatch = /^WAIT_TIMEOUT="\$\{VERIFY_WAIT_TIMEOUT:-([0-9]+)\}"/m.exec(
  script,
);
if (!composeFileMatch || !servicesMatch || !waitTimeoutMatch || !envFileMatch) {
  fail(
    NAME,
    [
      `${SCRIPT}: no se pudieron leer COMPOSE_FILE / ENV_FILE / SERVICES / WAIT_TIMEOUT; la comprobación no puede comparar nada y NO se da por buena`,
    ],
    'si el script cambió de forma, actualiza este check antes que el README: un check que no sabe leer su fuente pasaría en verde sin mirar',
  );
}

const scriptUpLine = script
  .split(/\r?\n/)
  .find((line) => /\bdc up\b/.test(line));
if (scriptUpLine === undefined) {
  fail(
    NAME,
    [`${SCRIPT}: no se encontró la invocación 'dc up …'`],
    'misma razón que arriba: sin fuente que leer, esto no es una comprobación',
  );
}

const scriptTokens = scriptUpLine
  .trim()
  .split(/\s+/)
  // El `up` del script vive dentro de un `if ! … ; then`, así que el último argumento llega con el `;` pegado
  // por fuera de las comillas (`"${SERVICES[@]}";`). Se quita **antes** de desentrecomillar o la expansión falla.
  .map((token) => token.replace(/;$/, ''))
  .map(unquote)
  .flatMap((token) => {
    if (token === 'dc') {
      return [
        'docker',
        'compose',
        '-f',
        unquote(composeFileMatch[1].trim()),
        '--env-file',
        unquote(envFileMatch[1].trim()),
      ];
    }
    if (token === '$WAIT_TIMEOUT' || token === '${WAIT_TIMEOUT}') {
      return [waitTimeoutMatch[1]];
    }
    if (token === '${SERVICES[@]}') {
      return servicesMatch[1].trim().split(/\s+/).filter(Boolean);
    }
    return [token];
  })
  // `if ! dc up …; then` — se quitan las piezas del `if`, que no son de la orden.
  .filter((token) => !['if', '!', 'then'].includes(token));

const executed = parseUp(scriptTokens);
if (executed === undefined) {
  fail(NAME, [`${SCRIPT}: la línea del 'up' no se pudo tokenizar`], 'ver arriba');
}

// Las órdenes `run` del script **después** de su `up`. El script invoca Compose con `dc` o, cuando la orden va con
// plazo, con `dc_bounded` (`timeout` no puede ejecutar una función de la shell); los dos llevan su `-f` y su
// `--env-file`, que ya se comparan en el `up`.
function isScriptCompose(tokens, index) {
  return ['dc', 'dc_bounded'].includes(tokens[index]) || isDockerCompose(tokens, index);
}
const scriptLines = script.split(/\r?\n/);
const executedRuns = [];
for (const line of scriptLines.slice(scriptLines.indexOf(scriptUpLine) + 1)) {
  if (line.trim().startsWith('#')) {
    continue;
  }
  const run = runCommand(line.trim().split(/\s+/).map(unquote), isScriptCompose);
  if (run !== undefined) {
    executedRuns.push(run);
  }
}

// --- El cotejo -----------------------------------------------------------------------------------------------------
if (documented.composeFile !== executed.composeFile) {
  findings.push(
    `fichero de compose distinto: ${README} documenta '${documented.composeFile}' y ${SCRIPT} levanta '${executed.composeFile}'`,
  );
}

const documentedServices = [...documented.services].sort();
const executedServices = [...executed.services].sort();
const missing = executedServices.filter((s) => !documentedServices.includes(s));
const extra = documentedServices.filter((s) => !executedServices.includes(s));
if (missing.length > 0) {
  findings.push(
    `${README} no documenta servicios que ${SCRIPT} sí levanta: ${missing.join(', ')}`,
  );
}
if (extra.length > 0) {
  findings.push(
    `${README} documenta servicios que ${SCRIPT} no levanta: ${extra.join(', ')}`,
  );
}

for (const flag of ['--wait', '--pull never']) {
  const inDoc = documented.flags.has(flag);
  const inScript = executed.flags.has(flag);
  if (inDoc !== inScript) {
    findings.push(
      `la bandera '${flag}' está ${inDoc ? 'solo en ' + README : 'solo en ' + SCRIPT}: el camino documentado y el verificado no se comportan igual`,
    );
  }
}

if (documented.waitTimeout === undefined) {
  findings.push(
    `${README} documenta el 'up' sin '--wait-timeout': sin plazo el fallo llega por el timeout de quien mira, no con su propio mensaje`,
  );
} else if (documented.waitTimeout !== executed.waitTimeout) {
  findings.push(
    `plazo distinto: ${README} documenta --wait-timeout ${documented.waitTimeout} y ${SCRIPT} usa ${executed.waitTimeout} (el número y su justificación viven en el script)`,
  );
}

// Dos hallazgos que la igualdad por sí sola NO cubre, porque pasarían si alguien cambiase **los dos** lados a la vez:
if (documentedServices.includes('traefik') || executedServices.includes('traefik')) {
  findings.push(
    `'traefik' aparece en la selección de servicios: el borde (DNS y ACME) queda fuera del alcance en ADR-048 §4, y ${README} afirma que no se levanta`,
  );
}
if (documented.envFile === CI_ENV_FILE) {
  findings.push(
    `${README} documenta '--env-file ${CI_ENV_FILE}', que es el fichero de relleno del corredor y lleva escrito que no sirve para ningún despliegue (tarea 5.3); el camino a mano parte de '.env.example'`,
  );
}

// --- Las órdenes `run` de después del `up` (design D5 de `object-store`) --------------------------------------------
// Absoluta, en cada lado por separado: la igualdad de abajo pasaría si alguien quitase las dos órdenes de los dos.
checkProvisionThenVerify(README, documentedRuns);
checkProvisionThenVerify(SCRIPT, executedRuns);

// Relativa: las mismas órdenes y en el mismo orden.
if (documentedRuns.join('\n') !== executedRuns.join('\n')) {
  findings.push(
    `las órdenes 'run' tras el 'up' no son las mismas o no van en el mismo orden: ${README} documenta [${documentedRuns.join(' ; ') || 'ninguna'}] y ${SCRIPT} ejecuta [${executedRuns.join(' ; ') || 'ninguna'}]`,
  );
}

documentedRunFiles.forEach((file, index) => {
  if (file !== documented.composeFile) {
    findings.push(
      `${README}: '${documentedRuns[index]}' usa el fichero de compose '${file ?? '(ninguno)'}' y el 'up' documentado '${documented.composeFile}'`,
    );
  }
});

if (findings.length > 0) {
  fail(
    NAME,
    findings,
    `iguala el bloque marcado con '${SENTINEL}' en ${README} y la invocación de ${SCRIPT}`,
  );
}

pass(
  NAME,
  `el 'up' documentado en ${README} y el de ${SCRIPT} coinciden: ${executed.composeFile}, ${executedServices.length} servicios (${executedServices.join(', ')}), --wait --wait-timeout ${executed.waitTimeout} --pull never, sin traefik; y después del 'up', en los dos, provision y después verify, con las mismas ${executedRuns.length} órdenes 'run' en el mismo orden`,
);
