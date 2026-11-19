/**
 * Comprobación: las constantes de `infra/backup/requeue-outbox.js` coinciden con el esquema del outbox (ADR-066, design D12,
 * C9; tarea 6.3a de `staging-backups`).
 *
 * `requeue-outbox.js` es un script de `mongosh` que corre fuera de la aplicación y no puede importar el esquema de Mongoose, así
 * que lleva el nombre de la colección y los de los campos como constantes. Si alguien renombra un campo en
 * `apps/api/src/infrastructure/outbox/outbox-event.schemas.ts`, el reencolado dejaría de encontrar eventos sin hacer ruido: aquí
 * se compara y se falla, nombrando la constante y el esquema.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_ROOT } from './lib/compose.mjs';
import { fail, pass } from './lib/report.mjs';

const NAME = 'backup-outbox-contract';
const SCRIPT = 'infra/backup/requeue-outbox.js';
const SCHEMA = 'apps/api/src/infrastructure/outbox/outbox-event.schemas.ts';
const COMPOSE = 'docker-compose.prod.yml';

const read = (relative) => readFileSync(join(WORKSPACE_ROOT, relative), 'utf8');
const script = read(SCRIPT);
const schema = read(SCHEMA);
const compose = read(COMPOSE);

const findings = [];

const block = script.match(
  /OUTBOX-CONTRACT-BEGIN\s*([\s\S]*?)\s*\/\/ OUTBOX-CONTRACT-END/,
);
if (block === null) {
  fail(
    NAME,
    [
      `${SCRIPT}: no encuentro el bloque OUTBOX-CONTRACT-BEGIN … OUTBOX-CONTRACT-END`,
    ],
    'son las constantes que esta comprobación compara',
  );
}
const constants = Object.fromEntries(
  [...block[1].matchAll(/^\s*(\w+):\s*'([^']*)'/gm)].map((match) => [
    match[1],
    match[2],
  ]),
);

const collection = schema.match(
  /OUTBOX_EVENTS_COLLECTION\s*=\s*'([^']+)'/,
)?.[1];
if (collection === undefined) {
  findings.push(`${SCHEMA}: no encuentro OUTBOX_EVENTS_COLLECTION`);
} else if (constants.collection !== collection) {
  findings.push(
    `${SCRIPT}: collection es '${constants.collection}' y el esquema (${SCHEMA}) llama a la colección '${collection}'`,
  );
}

// Campos del documento: los de la interfaz `OutboxEventDocument` y los del `new Schema<…>({ … })`.
const iface =
  schema.match(/interface OutboxEventDocument\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
const interfaceFields = new Set(
  [...iface.matchAll(/^\s{2}(\w+)\??:/gm)].map((match) => match[1]),
);
const definition =
  schema.match(
    /new Schema<OutboxEventDocument>\(\s*\{([\s\S]*?)\n\s{2}\},\s*\{/,
  )?.[1] ?? '';
const schemaFields = new Set(
  [...definition.matchAll(/^\s{4}(\w+):/gm)].map((match) => match[1]),
);

for (const key of [
  'type',
  'publishedAt',
  'failedAt',
  'attempts',
  'nextAttemptAt',
]) {
  const field = constants[key];
  if (field === undefined) {
    findings.push(`${SCRIPT}: falta la constante ${key}`);
    continue;
  }
  if (!interfaceFields.has(field)) {
    findings.push(
      `${SCRIPT}: ${key} = '${field}' no es un campo de OutboxEventDocument en ${SCHEMA} (campos: ${[...interfaceFields].join(', ')})`,
    );
  }
  if (!schemaFields.has(field)) {
    findings.push(
      `${SCRIPT}: ${key} = '${field}' no está en la definición del esquema de ${SCHEMA} (campos: ${[...schemaFields].join(', ')})`,
    );
  }
}

// La base: la de `MONGO_URI` del compose de producción.
const database = compose.match(/@mongo:27017\/([A-Za-z0-9_-]+)\?/)?.[1];
if (database === undefined) {
  findings.push(`${COMPOSE}: no encuentro la base de MONGO_URI`);
} else if (constants.database !== database) {
  findings.push(
    `${SCRIPT}: database es '${constants.database}' y MONGO_URI de ${COMPOSE} usa '${database}'`,
  );
}

if (findings.length > 0) {
  fail(
    NAME,
    findings,
    `actualiza las constantes de ${SCRIPT} (y revisa el reencolado) cuando cambie el esquema del outbox`,
  );
}
pass(
  NAME,
  `${SCRIPT}: colección '${constants.collection}', base '${constants.database}' y 5 campos coinciden con ${SCHEMA}`,
);
