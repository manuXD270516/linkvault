import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixtureMissing } from '../domain/errors';
import type { RunContext } from '../domain/run-context';
import { MockDeterministicProvider } from '../infrastructure/providers/mock-deterministic.provider';
import { classifySkillsTask } from '../tasks/classify-skills.task';
import { extractJobTask } from '../tasks/extract-job.task';
import { executionKey } from './execution-key';
import {
  PENDING_FIXTURES_DEFAULT_PATH,
  PENDING_FIXTURES_FILE_VAR,
  PENDING_FIXTURES_OFF,
  PENDING_FIXTURES_SWITCH_VAR,
  pendingFixturePath,
  readPendingFixtures,
  type PendingFixture,
} from './pending-fixtures';
import { RunTask } from './run-task.usecase';
import {
  InMemoryAiLogger,
  InMemoryPromptRegistry,
  InMemoryQuotaPolicy,
  InMemoryResultCache,
  InMemoryUsageLedger,
  ManualClock,
  RecordingNullCircuitBreaker,
} from './testing/in-memory-ports';

// Escenarios del requisito "Registro de entradas pendientes de fixture" (specs/ai/deterministic-mock, tarea 4.6 de
// link-enrichment). Lo escribe `runTask` sobre un mock en replay con un directorio de fixtures vacío.

const CTX: RunContext = { aiConsent: { externalProviders: false } };
const PAGE = {
  text: 'Analista de Datos\nBuscamos a alguien con Python y SQL.\nRequisitos: tres años.',
};

function runTaskWithEmptyFixtures(fixturesDir: string): RunTask {
  return new RunTask({
    providers: [new MockDeterministicProvider({ mode: 'replay', fixturesDir })],
    prompts: new InMemoryPromptRegistry(),
    cache: new InMemoryResultCache(),
    ledger: new InMemoryUsageLedger(),
    quota: new InMemoryQuotaPolicy(),
    breaker: new RecordingNullCircuitBreaker(),
    clock: new ManualClock(),
    logger: new InMemoryAiLogger(),
  });
}

describe('Registro de entradas pendientes de fixture', () => {
  let root: string;
  let logPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lv-pending-'));
    logPath = join(root, 'pending.jsonl');
    vi.stubEnv(PENDING_FIXTURES_FILE_VAR, logPath);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it('Entrada anotada', async () => {
    const runTask = runTaskWithEmptyFixtures(join(root, 'fixtures'));

    await expect(
      runTask.execute(extractJobTask, PAGE, CTX),
    ).rejects.toBeInstanceOf(FixtureMissing);

    const key = executionKey({
      taskName: 'extract-job',
      promptVersion: 'v1',
      outputLanguage: 'es',
      input: extractJobTask.inputSchema.parse(PAGE),
    });
    expect(readPendingFixtures(logPath)).toEqual([
      {
        task: 'extract-job',
        promptVersion: 'v1',
        outputLanguage: 'es',
        key,
        input: PAGE,
        redacted: false,
      },
    ]);
  });

  it('Test que espera la ausencia', async () => {
    vi.stubEnv(PENDING_FIXTURES_SWITCH_VAR, PENDING_FIXTURES_OFF);
    const runTask = runTaskWithEmptyFixtures(join(root, 'fixtures'));

    await expect(
      runTask.execute(extractJobTask, PAGE, CTX),
    ).rejects.toBeInstanceOf(FixtureMissing);

    expect(readPendingFixtures(logPath)).toEqual([]);
    await expect(readFile(logPath, 'utf8')).rejects.toThrow();
  });

  it('Fuera de los tests', () => {
    // `VITEST` lo fija el propio corredor: sin él, la aplicación corriendo de verdad no escribe nada.
    const env = { [PENDING_FIXTURES_FILE_VAR]: logPath };

    expect(pendingFixturePath(env)).toBeNull();
    expect(pendingFixturePath({ ...env, VITEST: 'true' })).toBe(logPath);
  });

  it('Entrada de una tarea con datos personales', async () => {
    const runTask = runTaskWithEmptyFixtures(join(root, 'fixtures'));

    await expect(
      runTask.execute(
        classifySkillsTask,
        { text: 'Ana Pérez, ana@example.com, diez años con TypeScript' },
        CTX,
      ),
    ).rejects.toBeInstanceOf(FixtureMissing);

    const [entry] = readPendingFixtures(logPath);
    expect(entry).toMatchObject({ task: 'classify-skills', redacted: true });
    expect(entry).not.toHaveProperty('input');
    await expect(readFile(logPath, 'utf8')).resolves.not.toContain('Ana Pérez');
  });
});

describe('Lectura del registro', () => {
  let root: string;
  let logPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lv-pending-read-'));
    logPath = join(root, 'pending.jsonl');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('La misma entrada dos veces', async () => {
    // Dos procesos escribiendo a la vez, como dos archivos de test en paralelo: ninguna anotación se pierde ni se
    // entrelaza, y al consumir queda una sola entrada por clave.
    const entry = (key: string, task: string): PendingFixture => ({
      task,
      promptVersion: 'v1',
      outputLanguage: 'es',
      key,
      input: { text: 'x'.repeat(200) },
      redacted: false,
    });
    const shared = entry('a'.repeat(64), 'extract-job');
    const other = entry('b'.repeat(64), 'classify-skills');

    await Promise.all([
      appendFromChild(logPath, shared, 40),
      appendFromChild(logPath, shared, 40),
      appendFromChild(logPath, other, 20),
    ]);

    const raw = await readFile(logPath, 'utf8');
    expect(raw.split('\n').filter((line) => line !== '')).toHaveLength(100);
    // Sin orden: el registro conserva el de la primera aparición, y cuál de los tres procesos escribe antes lo decide
    // el sistema operativo. Lo que sí se afirma es que no se pierde ninguna clave y que ninguna se repite.
    const pending = readPendingFixtures(logPath);
    expect(pending).toHaveLength(2);
    expect(pending).toEqual(expect.arrayContaining([shared, other]));
  });

  it('ignora líneas rotas y devuelve las demás', async () => {
    const good: PendingFixture = {
      task: 'extract-job',
      promptVersion: 'v1',
      outputLanguage: 'es',
      key: 'c'.repeat(64),
      redacted: false,
      input: { text: 'una página' },
    };
    await writeFile(
      logPath,
      [
        '{no es json',
        JSON.stringify({ task: 'extract-job' }),
        '',
        JSON.stringify(good),
      ].join('\n'),
      'utf8',
    );

    expect(readPendingFixtures(logPath)).toEqual([good]);
  });

  it('devuelve una lista vacía cuando el registro no existe', () => {
    expect(readPendingFixtures(join(root, 'no-existe.jsonl'))).toEqual([]);
  });

  it('resuelve la ruta por defecto contra la raíz del workspace', () => {
    expect(
      pendingFixturePath({ VITEST: 'true', NX_WORKSPACE_ROOT: root }),
    ).toBe(join(root, PENDING_FIXTURES_DEFAULT_PATH));
  });
});

/** Escribe `times` veces la misma entrada desde otro proceso, con `O_APPEND` como el registro real. */
function appendFromChild(
  path: string,
  entry: PendingFixture,
  times: number,
): Promise<void> {
  const script = [
    'const { appendFileSync } = require("node:fs");',
    'const [path, line, times] = process.argv.slice(1);',
    'for (let i = 0; i < Number(times); i++) appendFileSync(path, line + "\\n", "utf8");',
  ].join('\n');
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      ['-e', script, path, JSON.stringify(entry), String(times)],
      { stdio: 'ignore' },
    );
    child.on('error', fail);
    child.on('close', (code) =>
      code === 0
        ? done()
        : fail(new Error(`child exited with ${String(code)}`)),
    );
  });
}
