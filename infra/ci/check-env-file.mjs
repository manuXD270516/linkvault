#!/usr/bin/env node
// =====================================================================================================================
// Revisión de un env file de despliegue (.env.staging / .env.prod) contra el contrato de docker-compose.prod.yml.
// =====================================================================================================================
// Paso 2 de infra/revision-despliegue.md. Uso, desde la raíz del repositorio o en el host junto al compose:
//
//   node infra/ci/check-env-file.mjs /srv/linkvault-staging/.env.staging
//
// **Nunca imprime un valor**: solo el nombre de cada comprobación y PASS/FAIL, porque el fichero contiene secretos
// (CLAUDE.md: nunca loguear claves). Sale ≠0 si falla alguna.
//
// Las obligatorias no están copiadas aquí: se leen de los `${VAR:?}` de docker-compose.prod.yml, así que la lista
// sigue sola al compose (quitar el almacén, añadir credenciales SMTP…). Lo demás son las reglas que el compose no
// puede expresar y que infra/README.md («Variables de entorno») documenta: formatos, valores prohibidos en producción y
// obligatorias condicionales. El arranque las vuelve a validar (zod) y aborta; esto las adelanta a antes del `up`.
// =====================================================================================================================
import { readFileSync } from 'node:fs';

const [envPath, composePath = 'docker-compose.prod.yml', examplePath = '.env.example'] = process.argv.slice(2);
if (!envPath) {
  process.stderr.write('usage: node infra/ci/check-env-file.mjs <env-file> [compose-file] [.env.example]\n');
  process.exit(2);
}

/** Pares clave-valor de un env file; si una clave se repite gana la última, igual que con `--env-file`. */
function parseEnv(path) {
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
}

const env = parseEnv(envPath);
const example = parseEnv(examplePath);
const compose = readFileSync(composePath, 'utf8');
const required = [...new Set([...compose.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map((match) => match[1]))].sort();
const declared = (name) => new RegExp(`\\b${name}\\b`).test(compose);

const has = (name) => (env[name] ?? '').trim() !== '';
const absoluteUrlWithoutTrailingSlash = (name) => /^https?:\/\/\S+[^/]$/.test(env[name] ?? '');
const chain = (name) => (env[name] ?? '').split(',').map((item) => item.trim()).filter(Boolean);

const results = [];
const check = (name, ok) => results.push([name, Boolean(ok)]);

for (const name of required) check(`${name} is set (required by ${composePath})`, has(name));

check('PUBLIC_PAGE_BASE_URL is an absolute URL without trailing slash', absoluteUrlWithoutTrailingSlash('PUBLIC_PAGE_BASE_URL'));
check('WEB_BASE_URL is an absolute URL without trailing slash', absoluteUrlWithoutTrailingSlash('WEB_BASE_URL'));
check(
  'AUTH_JWT_SECRET has >= 32 characters and differs from .env.example',
  (env.AUTH_JWT_SECRET ?? '').length >= 32 && env.AUTH_JWT_SECRET !== example.AUTH_JWT_SECRET,
);
check('AI_VAULT_KEY is base64 of exactly 32 bytes', has('AI_VAULT_KEY') && Buffer.from(env.AI_VAULT_KEY, 'base64').length === 32);
for (const name of ['AI_CHAIN', 'AI_EMBED_CHAIN']) check(`${name} does not include mock`, !chain(name).includes('mock'));

check('MAIL_PROVIDER is smtp or resend (capture never sends)', ['smtp', 'resend'].includes(env.MAIL_PROVIDER));
if (env.MAIL_PROVIDER === 'smtp') {
  for (const name of ['MAIL_SMTP_HOST', 'MAIL_SMTP_PORT']) check(`${name} is set (MAIL_PROVIDER=smtp)`, has(name));
  // Credenciales SMTP: solo desde que el compose las declara (35b, letra (e) de ADR-051).
  for (const name of ['MAIL_SMTP_USER', 'MAIL_SMTP_PASSWORD']) {
    if (declared(name)) check(`${name} is set (MAIL_PROVIDER=smtp, declared by the compose)`, has(name));
  }
}
if (env.MAIL_PROVIDER === 'resend') check('RESEND_API_KEY is set (MAIL_PROVIDER=resend)', has('RESEND_API_KEY'));

if ([...chain('AI_CHAIN'), ...chain('AI_EMBED_CHAIN')].includes('openrouter')) {
  check('OPENROUTER_API_KEY is set (openrouter in a chain)', has('OPENROUTER_API_KEY'));
  check('OPENROUTER_MODEL ends with :free', /:free$/.test(env.OPENROUTER_MODEL ?? ''));
}

const secrets = ['AUTH_JWT_SECRET', 'AI_VAULT_KEY', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'MINIO_KMS_SECRET_KEY', 'MAIL_SMTP_PASSWORD'];
check('no secret keeps its .env.example value', secrets.every((name) => !has(name) || env[name] !== example[name]));

let failed = 0;
for (const [name, ok] of results) {
  if (!ok) failed += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}\n`);
}
process.stdout.write(failed === 0 ? '\nall checks passed\n' : `\n${failed} check(s) failed\n`);
process.exitCode = failed === 0 ? 0 : 1;
