import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifySkillsEvaluable } from '../evaluable-tasks';
import { goldenPath, loadGolden } from '../golden.schema';
import { baselinePath } from '../runner/baseline';

// Tareas 3.6 y 3.7: test de humo del CLI en un proceso hijo (D2 y D6 de ai-eval-harness; escenarios "Fixture ausente en
// replay" y "Proveedor real no disponible"). Se lanza `node --import <URL absoluta de tsx>` como hace el target de Nx,
// con `TSX_TSCONFIG_PATH` absoluto, un directorio de trabajo temporal y un entorno mínimo sin `.env`.

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const CLI = join(import.meta.dirname, 'eval.ts');
const TSX_URL = pathToFileURL(
  createRequire(import.meta.url).resolve('tsx'),
).href;
const TSCONFIG = join(WORKSPACE_ROOT, 'libs/ai/tsconfig.lib.json');
const PROMPTS_DIR = join(WORKSPACE_ROOT, 'libs/ai/src/infrastructure/prompts');
const TASK = 'classify-skills';
const SMOKE_TIMEOUT_MS = 60_000;

const GOLDEN = [
  {
    id: 'es-01',
    input: { text: 'Backend con TypeScript y Docker' },
    expected: { skills: ['TypeScript', 'Docker'] },
    tags: ['placeholder'],
  },
  {
    id: 'en-01',
    input: { text: 'Frontend with Angular' },
    expected: { skills: ['Angular'] },
    tags: ['placeholder'],
    outputLanguage: 'en',
  },
];

interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

describe('eval CLI in a child process', () => {
  let root: string;
  let evalsDir: string;
  let reportsDir: string;
  let fixturesDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lv-eval-smoke-'));
    evalsDir = join(root, 'evals');
    reportsDir = join(root, 'reports');
    fixturesDir = join(root, 'fixtures');
    await mkdir(join(evalsDir, TASK), { recursive: true });
    await mkdir(join(fixturesDir, TASK), { recursive: true });
    await writeFile(
      goldenPath(evalsDir, TASK),
      `${GOLDEN.map((line) => JSON.stringify(line)).join('\n')}\n`,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Entorno mínimo: sin `.env` ni variables del proceso de Vitest (que fija AI_CHAIN y AI_MOCK_MODE). */
  function minimalEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'test',
      TSX_TSCONFIG_PATH: TSCONFIG,
      AI_PROMPTS_DIR: PROMPTS_DIR,
      AI_FIXTURES_DIR: fixturesDir,
    };
    // Windows necesita SystemRoot para arrancar Node con red y criptografía.
    const systemRoot = process.env['SystemRoot'];
    if (systemRoot !== undefined) env['SystemRoot'] = systemRoot;
    return env;
  }

  function runCli(args: readonly string[]): Promise<CliRun> {
    return new Promise((done, fail) => {
      const child = spawn(
        process.execPath,
        [
          '--import',
          TSX_URL,
          CLI,
          ...args,
          `--evals-dir=${evalsDir}`,
          `--reports-dir=${reportsDir}`,
        ],
        { cwd: root, env: minimalEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.on('error', fail);
      child.on('close', (code) => done({ code, stdout, stderr }));
    });
  }

  async function writeFixtures() {
    const golden = await loadGolden(classifySkillsEvaluable, evalsDir);
    if (!golden.ok) throw new Error('invalid test golden');
    for (const goldenCase of golden.cases) {
      await writeFile(
        join(fixturesDir, TASK, `${goldenCase.key}.json`),
        JSON.stringify({
          source: 'handwritten',
          text: JSON.stringify({
            skills: goldenCase.expected.skills.map((name) => ({
              name,
              category: 'tool',
            })),
          }),
          model: 'fixture-model',
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
      );
    }
    return golden.cases;
  }

  it(
    'exits with 0 and writes the report, then with 1 when the baseline is altered',
    async () => {
      await writeFixtures();

      const update = await runCli([
        `--task=${TASK}`,
        '--provider=mock',
        '--update-baseline',
      ]);
      expect(update, update.stderr).toMatchObject({ code: 0 });

      const replay = await runCli([`--task=${TASK}`, '--provider=mock']);
      expect(replay, replay.stderr).toMatchObject({ code: 0 });
      expect(replay.stdout).toContain('2 cases, 2 success, 0 degraded');
      const report = await readFile(join(reportsDir, TASK, 'mock.md'), 'utf8');
      expect(report).toContain('# Evaluación de IA: classify-skills');
      expect(report).toContain('| `en-01` | placeholder | success |');

      const path = baselinePath(evalsDir, TASK);
      const baseline = JSON.parse(await readFile(path, 'utf8')) as {
        metrics: Record<string, number>;
      };
      baseline.metrics['skills_recall'] = 0.5;
      await writeFile(path, JSON.stringify(baseline));

      const regression = await runCli([`--task=${TASK}`, '--provider=mock']);
      expect(regression.code).toBe(1);
      expect(regression.stderr).toContain('skills_recall mejoró');
      expect(regression.stderr).toContain(
        'nx run ai:eval --task=classify-skills --provider=mock --update-baseline',
      );
    },
    SMOKE_TIMEOUT_MS,
  );

  it(
    'Fixture ausente en replay',
    async () => {
      const cases = await writeFixtures();
      const missing = cases[1];
      if (missing === undefined) throw new Error('invalid test golden');
      await unlink(join(fixturesDir, TASK, `${missing.key}.json`));

      const run = await runCli([`--task=${TASK}`, '--provider=mock']);

      expect(run.code, run.stderr).toBe(3);
      expect(run.stderr).toContain('"en-01"');
      expect(run.stderr).toContain(missing.key);
      expect(run.stderr).toContain('FixtureMissing');
    },
    SMOKE_TIMEOUT_MS,
  );

  it(
    'Proveedor real no disponible',
    async () => {
      const port = await closedPort();

      const run = await runCli([
        `--task=${TASK}`,
        '--provider=ollama',
        `--ollama-url=http://127.0.0.1:${String(port)}`,
        '--timeout-ms=5000',
      ]);

      expect(run.code, run.stderr).toBe(0);
      expect(run.stdout).toContain('2 cases, 0 success, 2 degraded');
      const report = await readFile(
        join(reportsDir, TASK, 'ollama.md'),
        'utf8',
      );
      expect(report).toContain('- Proveedor: `ollama`');
      expect(report).toContain('- Prompt: `v1`');
      expect(report).toContain('- Modelo: qwen2.5:7b');
      expect(report).toContain(
        '| `es-01` | placeholder | degraded (providers_failed) |',
      );
      expect(report).toContain('| `degraded_rate` | bloqueante | 1 |');
      // Con proveedores reales no se toca la línea base.
      await expect(readFile(baselinePath(evalsDir, TASK))).rejects.toThrow();
    },
    SMOKE_TIMEOUT_MS,
  );
});

/** Un puerto local libre en el que no escucha nadie. */
function closedPort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => done(port));
    });
  });
}
