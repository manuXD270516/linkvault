/**
 * Comprobación: ningún **valor por defecto** apunta a un recurso que el repositorio documenta como muerto, ni a un
 * espacio de nombres de imagen ajeno.
 *
 * El alcance, las exclusiones y el motivo de cada una están declarados en `stale-defaults.registry.mjs`: se miran
 * los **tres** sitios donde vive un valor por defecto —el ejemplo, el compose de producción y el default del
 * código— y **ningún** fichero de test. Corregir solo el ejemplo no basta para que esto pase, que es justo lo que
 * el requirement pide.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyDeclaration,
  loadCompose,
  serviceEnvironment,
  WORKSPACE_ROOT,
} from './lib/compose.mjs';
import { fail, pass } from './lib/report.mjs';
import {
  DEAD_RESOURCES,
  DEFAULT_VALUE_SITES,
  FOREIGN_IMAGE_NAMESPACES,
  OWN_IMAGE_NAMESPACE,
} from './stale-defaults.registry.mjs';

const NAME = 'stale-defaults';

const findings = [];
let inspected = 0;

/** @param {string} where @param {string} variable @param {string} value */
function checkValue(where, variable, value) {
  inspected += 1;
  const dead = DEAD_RESOURCES.find((resource) => resource.value === value);
  if (dead !== undefined) {
    findings.push(
      `${where}: ${variable} tiene como valor por defecto el ${dead.kind} '${dead.value}', que este repositorio documenta como muerto (${dead.evidence}). Sustituto: ${dead.replacement}`,
    );
  }
}

// --- 1) `.env.example` -------------------------------------------------------------------------------------------
// Solo asignaciones `VARIABLE=valor`, comentadas o no: un `# VAR=valor` es un valor por defecto que alguien
// descomentará. La prosa que **nombra** el recurso muerto para decir que lo es no casa con este patrón.
const ENV_ASSIGNMENT = /^\s*#?\s*([A-Z][A-Z0-9_]*)=(.*)$/;
const envExample = readFileSync(
  join(WORKSPACE_ROOT, DEFAULT_VALUE_SITES.envExample),
  'utf8',
);
envExample.split(/\r?\n/).forEach((line, index) => {
  const match = ENV_ASSIGNMENT.exec(line);
  if (match === null) return;
  checkValue(
    `${DEFAULT_VALUE_SITES.envExample}:${index + 1}`,
    match[1],
    match[2].trim(),
  );
});

// --- 2) compose de producción ------------------------------------------------------------------------------------
const compose = loadCompose();
for (const service of DEFAULT_VALUE_SITES.composeServices) {
  for (const [variable, raw] of serviceEnvironment(compose, service)) {
    const declaration = classifyDeclaration(raw);
    // Solo `${VAR:-…}` y los literales fijan un valor por defecto. `${VAR:?}` aborta el `up` nombrando la variable:
    // no elige nada por el operador, que es lo que esta comprobación vigila.
    if (declaration.kind === 'default') {
      checkValue(
        `${DEFAULT_VALUE_SITES.compose} (servicio '${service}')`,
        variable,
        declaration.defaultValue.trim(),
      );
    } else if (declaration.kind === 'fixed') {
      checkValue(
        `${DEFAULT_VALUE_SITES.compose} (servicio '${service}')`,
        variable,
        declaration.value.trim(),
      );
    }
  }
}

// Espacio de nombres de las imágenes (ADR-048 §4-bis): el valor por defecto de `image:` no puede apuntar a un
// registro que el proyecto no controla.
for (const [service, definition] of Object.entries(compose.services ?? {})) {
  const image = definition?.image;
  if (typeof image !== 'string') continue;
  const declaration = classifyDeclaration(image);
  if (declaration.kind !== 'default') continue;
  const name = declaration.defaultValue.trim();
  inspected += 1;
  const foreign = FOREIGN_IMAGE_NAMESPACES.find((namespace) =>
    name.startsWith(namespace.prefix),
  );
  if (foreign !== undefined) {
    findings.push(
      `${DEFAULT_VALUE_SITES.compose} (servicio '${service}'): la imagen por defecto es '${name}', del espacio de nombres '${foreign.prefix}' — ${foreign.reason}. Usa '${OWN_IMAGE_NAMESPACE}…'`,
    );
  } else if (name.startsWith('ghcr.io/') && !name.startsWith(OWN_IMAGE_NAMESPACE)) {
    findings.push(
      `${DEFAULT_VALUE_SITES.compose} (servicio '${service}'): la imagen por defecto es '${name}', fuera del espacio de nombres del repositorio ('${OWN_IMAGE_NAMESPACE}'). Un valor por defecto hacia territorio ajeno es una vía de suministro`,
    );
  }
}

// --- 3) el valor por defecto del código --------------------------------------------------------------------------
// Es el que gana cuando la variable falta o está vacía, así que "vaciar la variable" no corrige nada por sí solo.
const codeFile = DEFAULT_VALUE_SITES.codeDefaults.file;
const codeText = readFileSync(join(WORKSPACE_ROOT, codeFile), 'utf8');
const constantStart = codeText.indexOf(
  `${DEFAULT_VALUE_SITES.codeDefaults.constant} = {`,
);
if (constantStart === -1) {
  findings.push(
    `${codeFile}: no se encuentra '${DEFAULT_VALUE_SITES.codeDefaults.constant} = {'. O se ha renombrado (actualiza tools/repo-checks/src/stale-defaults.registry.mjs) o los valores por defecto del código han dejado de comprobarse`,
  );
} else {
  const constantEnd = codeText.indexOf('\n} as const;', constantStart);
  const block = codeText.slice(
    constantStart,
    constantEnd === -1 ? codeText.length : constantEnd,
  );
  const before = codeText.slice(0, constantStart);
  const firstLine = before.split('\n').length;
  const CODE_DEFAULT = /^\s*([A-Z][A-Z0-9_]*):\s*'([^']*)'/;
  block.split('\n').forEach((line, index) => {
    const match = CODE_DEFAULT.exec(line);
    if (match === null) return;
    checkValue(`${codeFile}:${firstLine + index}`, match[1], match[2]);
  });
}

if (findings.length > 0) {
  fail(
    NAME,
    findings,
    'cambia el valor por defecto en TODOS los sitios donde vive (ejemplo, compose y código): arreglar solo uno deja la avería donde más cuesta verla. Si un recurso ha dejado de estar muerto, quítalo de DEAD_RESOURCES con la constancia de la pasada',
  );
}

pass(
  NAME,
  `${inspected} valores por defecto inspeccionados en ${DEFAULT_VALUE_SITES.envExample}, ${DEFAULT_VALUE_SITES.compose} y ${codeFile}; ${DEAD_RESOURCES.length} recurso(s) muerto(s) y ${FOREIGN_IMAGE_NAMESPACES.length} espacio(s) de nombres ajeno(s) en el registro. Los ficheros de test quedan fuera a propósito (ver stale-defaults.registry.mjs)`,
);
