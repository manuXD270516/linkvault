#!/usr/bin/env node
// =====================================================================================================================
// Prueba de las reglas del respaldo de `infra/ci/check-env-file.mjs` (tarea 7.2 de `staging-backups`; ADR-066, design D16, C23).
// =====================================================================================================================
// Arma un fichero de entorno COMPLETO con valores aleatorios (a partir del relleno de CI, cambiando sus secretos) y lo revisa con
// el compose del respaldo como cuarto argumento:
//   - completo → sale 0;
//   - al que le falta CADA variable del respaldo, por turnos → sale ≠0 nombrándola;
//   - con formatos malos (dirección http, clave corta, contraseña con «/», el relleno de CI, un tope en cero) → sale ≠0;
//   - en ningún caso la salida contiene un valor del fichero (solo nombres).
// Uso: node infra/ci/test-check-env-file-backup.mjs   (sale 0 si todo pasa; la última línea dice cuántos casos corrió)
// =====================================================================================================================
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = join(root, 'infra/ci/check-env-file.mjs');
const hex = (bytes) => randomBytes(bytes).toString('hex');

const base = readFileSync(join(root, 'infra/ci/verify.env'), 'utf8')
  .split(/\r?\n/)
  .filter((line) => /^[A-Z0-9_]+=/.test(line));
const complete = Object.fromEntries(
  base.map((line) => [
    line.slice(0, line.indexOf('=')),
    line.slice(line.indexOf('=') + 1),
  ]),
);
Object.assign(complete, {
  MAIL_SMTP_USER: 'lvmail',
  MAIL_SMTP_PASSWORD: hex(16),
  MONGO_ROOT_USER: 'lvroot',
  MONGO_ROOT_PASSWORD: hex(32),
  REDIS_PASSWORD: hex(32),
  OBJECT_STORE_SSE_KEY: hex(32),
  S3_ACCESS_KEY: 'lvkey',
  S3_SECRET_KEY: hex(20),
  MONGO_BACKUP_USER: 'lvbackup',
  MONGO_BACKUP_PASSWORD: hex(32),
  S3_BACKUP_ACCESS_KEY: 'lvbk',
  S3_BACKUP_SECRET_KEY: hex(20),
  RESTIC_PASSWORD: hex(32),
  BACKUP_PING_URL: `https://hc-ping.example.invalid/${hex(8)}`,
  BACKUP_OCI_REPOSITORY:
    's3:https://ns.compat.objectstorage.example.invalid/bucket',
  BACKUP_OCI_ACCESS_KEY_ID: hex(8),
  BACKUP_OCI_SECRET_ACCESS_KEY: hex(16),
  BACKUP_OFFSITE_REPOSITORY: 's3:https://offsite.example.invalid/bucket',
  BACKUP_OFFSITE_ACCESS_KEY_ID: hex(8),
  BACKUP_OFFSITE_SECRET_ACCESS_KEY: hex(16),
});

const dir = mkdtempSync(join(tmpdir(), 'lv-envcheck-'));
let cases = 0;
let failures = 0;

function review(values) {
  const file = join(dir, 'case.env');
  writeFileSync(
    file,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
  );
  const run = spawnSync(
    process.execPath,
    [
      script,
      file,
      'docker-compose.prod.yml',
      '.env.example',
      'infra/backup/docker-compose.backup.yml',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

function check(name, ok, detail = '') {
  cases += 1;
  if (!ok) failures += 1;
  process.stdout.write(
    `${ok ? '  ok  ' : '  FAIL'} ${name}${ok || detail === '' ? '' : ` — ${detail}`}\n`,
  );
}

const secretValues = (values) =>
  Object.entries(values)
    .filter(([key]) => /PASSWORD|SECRET|KEY|URL|TOKEN/.test(key))
    .map(([, value]) => value)
    .filter((value) => value.length >= 8);

// 1. Completo.
const full = review(complete);
check(
  'a complete file passes',
  full.status === 0,
  full.output
    .split('\n')
    .filter((line) => line.startsWith('FAIL'))
    .join(' | '),
);
check(
  'no value is printed',
  secretValues(complete).every((value) => !full.output.includes(value)),
);

// 2. Cada variable del respaldo, por turnos.
const backupVariables = [
  'MONGO_BACKUP_USER',
  'MONGO_BACKUP_PASSWORD',
  'S3_BACKUP_ACCESS_KEY',
  'S3_BACKUP_SECRET_KEY',
  'RESTIC_PASSWORD',
  'BACKUP_PING_URL',
  'BACKUP_OCI_REPOSITORY',
  'BACKUP_OCI_ACCESS_KEY_ID',
  'BACKUP_OCI_SECRET_ACCESS_KEY',
  'BACKUP_OFFSITE_REPOSITORY',
  'BACKUP_OFFSITE_ACCESS_KEY_ID',
  'BACKUP_OFFSITE_SECRET_ACCESS_KEY',
];
for (const name of backupVariables) {
  const without = { ...complete };
  delete without[name];
  const run = review(without);
  const named = run.output
    .split('\n')
    .some((line) => line.startsWith('FAIL') && line.includes(name));
  const leaked = secretValues(without).some((value) =>
    run.output.includes(value),
  );
  check(
    `missing ${name} fails naming it and printing no value`,
    run.status !== 0 && named && !leaked,
    `código ${run.status}`,
  );
}

// 3. Formatos.
const bad = (name, patch, why) => {
  const run = review({ ...complete, ...patch });
  check(why, run.status !== 0, `código ${run.status}`);
};
bad(
  'ping',
  { BACKUP_PING_URL: 'http://hc-ping.example.invalid/x' },
  'BACKUP_PING_URL over http fails',
);
bad('restic', { RESTIC_PASSWORD: 'corta' }, 'a short RESTIC_PASSWORD fails');
bad(
  'restic-ci',
  {
    RESTIC_PASSWORD: base
      .find((line) => line.startsWith('RESTIC_PASSWORD='))
      .split('=')[1],
  },
  'the CI filler as RESTIC_PASSWORD fails',
);
bad(
  'mongo',
  { MONGO_BACKUP_PASSWORD: `${hex(16)}/${hex(16)}` },
  'a MONGO_BACKUP_PASSWORD with a slash fails',
);
bad(
  'mongo-ci',
  {
    MONGO_BACKUP_PASSWORD: base
      .find((line) => line.startsWith('MONGO_BACKUP_PASSWORD='))
      .split('=')[1],
  },
  'the CI filler as MONGO_BACKUP_PASSWORD fails',
);
bad(
  'same-user',
  { MONGO_BACKUP_USER: complete.MONGO_ROOT_USER },
  'a backup user equal to the root user fails',
);
bad('cap', { BACKUP_MAX_REPO_BYTES: '0' }, 'BACKUP_MAX_REPO_BYTES=0 fails');
bad(
  'repo',
  { BACKUP_OCI_REPOSITORY: 'https://not-restic' },
  'an OCI repository that is not s3:https fails',
);

rmSync(dir, { recursive: true, force: true });
process.stdout.write(
  `\ncheck-env-file (respaldo): ${cases} casos, ${failures} fallos\n`,
);
process.exit(failures === 0 ? 0 : 1);
