/**
 * Comprobación: la prueba del orquestador del respaldo (`infra/backup/test-run-backup.sh`) pasa (ADR-066, design D4 y D9,
 * tarea 4.7b de `staging-backups`).
 *
 * La prueba ejecuta `infra/backup/run-backup.sh` con un `docker`, un `curl` y un `flock` FALSOS y vigila lo que no debe pasar:
 * un `run` sin `--rm --no-deps -T`, un flujo reproducido en la salida del orquestador (marcador binario), `set -x`, una
 * credencial o la dirección del monitor en los argumentos, el manifiesto fuera de orden… Aquí solo se ejecuta y se traslada su
 * resultado: si falla, se reproduce su salida (que nombra la variable o el caso, nunca un valor).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WORKSPACE_ROOT } from './lib/compose.mjs';
import { fail, pass } from './lib/report.mjs';

const NAME = 'backup-run-script';
const TEST = join(WORKSPACE_ROOT, 'infra/backup/test-run-backup.sh');

if (!existsSync(TEST)) {
  fail(
    NAME,
    ['infra/backup/test-run-backup.sh no existe'],
    'la prueba del orquestador del respaldo es permanente',
  );
}

const run = spawnSync('bash', ['infra/backup/test-run-backup.sh'], {
  cwd: WORKSPACE_ROOT,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
if (run.error) {
  fail(NAME, [`no se pudo ejecutar bash: ${run.error.message}`]);
}
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const summary = output
  .split('\n')
  .reverse()
  .find((line) => /^run-backup: \d+ casos, \d+ fallos$/.test(line));

if (run.status !== 0 || summary === undefined) {
  const failing = output
    .split('\n')
    .filter(
      (line) =>
        /^\s+FAIL /.test(line) || /el valor de [A-Z_]+ aparece/.test(line),
    );
  fail(
    NAME,
    failing.length > 0
      ? failing
      : [
          `la prueba terminó con código ${run.status} sin informar sus casos: ${output.slice(-400)}`,
        ],
    'ejecuta `bash infra/backup/test-run-backup.sh` para ver el caso completo',
  );
}
pass(
  NAME,
  `infra/backup/test-run-backup.sh: ${summary.replace('run-backup: ', '')}`,
);
