#!/usr/bin/env node
// Hook Stop: corre `openspec validate --all` al cerrar el turno.
//
// Contrato de hooks de Claude Code: exit 0 sin salida = sin opinion (deja cerrar),
// exit 2 = bloquea el cierre y stderr se entrega a Claude como motivo. Usamos ese
// contrato y no el JSON de stdout porque su forma ha cambiado entre versiones y
// una salida que el harness no reconoce se trata como vacia (ver
// require-openspec-change.mjs).
//
// El comando anterior (`openspec validate --all | tail -n 10 || true`) no podia
// fallar: el pipe dejaba el exit code de `tail` y el `|| true` lo forzaba a 0.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const logDir = join(root, '.claude', 'logs');
const logFile = join(logDir, 'openspec-validate.log');
const MAX_LOG_BYTES = 256 * 1024;
const TAIL_LINES = 20;

function rotateIfNeeded() {
  try {
    if (statSync(logFile).size <= MAX_LOG_BYTES) return;
    const kept = readFileSync(logFile, 'utf8').slice(-Math.floor(MAX_LOG_BYTES / 2));
    writeFileSync(logFile, `--- log truncado ---\n${kept.slice(kept.indexOf('\n') + 1)}`, 'utf8');
  } catch {
    // El log es best-effort: nunca debe tumbar el hook.
  }
}

function log(header, body = '') {
  try {
    mkdirSync(logDir, { recursive: true });
    rotateIfNeeded();
    const indented = body
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '')
      .map((line) => `    ${line}`)
      .join('\n');
    appendFileSync(logFile, `[${new Date().toISOString()}] ${header}\n${indented ? `${indented}\n` : ''}`, 'utf8');
  } catch {
    // idem
  }
}

// `openspec validate --all` imprime una linea `✓` por item (74 hoy) mas un spinner
// en stderr. Para el motivo que ve Claude solo interesa lo que no pasó; el log si
// guarda la salida entera.
function digest(text, lines = TAIL_LINES) {
  const kept = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('✓') && !/^[-\\|/]\s*Validating\.\.\.$/.test(line));
  return kept.slice(-lines).join('\n');
}

function summaryLine(text) {
  const totals = text.split(/\r?\n/).find((line) => line.trim().startsWith('Totals:'));
  return totals?.trim() ?? digest(text, 1);
}

const chunks = [];
for await (const chunk of process.stdin) {
  chunks.push(chunk);
}
let payload = {};
try {
  payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  payload = {};
}
// Claude Code marca stop_hook_active cuando el turno ya sigue vivo por culpa de un
// hook Stop anterior. Bloquear otra vez encerraria la sesion en un bucle.
const alreadyBlocked = payload.stop_hook_active === true;

const localBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'openspec.cmd' : 'openspec');
const command = existsSync(localBin) ? localBin : 'openspec';

const result = spawnSync(command, ['validate', '--all'], {
  cwd: root,
  encoding: 'utf8',
  shell: true,
  windowsHide: true,
});

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

if (result.error || result.status === null) {
  // Sin CLI o proceso muerto por señal: registrar y dejar pasar. Bloquear el cierre
  // porque falte una herramienta seria peor que no validar.
  log(`skip — no se pudo ejecutar \`${command} validate --all\`: ${result.error?.message ?? 'sin exit code'}`);
  process.exit(0);
}

if (result.status === 0) {
  log(`ok — ${summaryLine(output) || 'validate --all sin salida'}`);
  process.exit(0);
}

log(`FAIL — exit=${result.status}${alreadyBlocked ? ' (stop_hook_active: no se bloquea de nuevo)' : ''}`, output);

if (alreadyBlocked) {
  process.exit(0);
}

process.stderr.write(
  `openspec validate --all fallo (exit ${result.status}). Arregla las specs antes de cerrar el turno.\n` +
    `Log completo: .claude/logs/openspec-validate.log\n\n${digest(output)}\n`,
);
process.exit(2);
