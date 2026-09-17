import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AiEnv } from '../../infrastructure/config/parse-ai-config';
import {
  classifySkillsEvaluable,
  EVALUABLE_TASKS,
  evaluableTaskNames,
} from '../evaluable-tasks';
import { goldenPath, loadGolden } from '../golden.schema';
import { EXIT_CODES } from './args';
import {
  goldenTaskDirs,
  registryCoherence,
  runEvalCommand,
  type CliIo,
} from './eval-command';

// Tarea 3.5: CLI `nx run ai:eval` en proceso (D2, D5 y D6 de ai-eval-harness; requisitos "Tareas evaluables",
// "Golden set por tarea" y "Corredor de evaluación").

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const REAL_EVALS_DIR = join(WORKSPACE_ROOT, 'libs/ai/src/evals');
const TASK = 'classify-skills';

const GOLDEN = [
  {
    id: 'es-01',
    input: {
      text: 'Backend con TypeScript y Docker. Contacto: rrhh@example.com',
    },
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

interface CapturedIo extends CliIo {
  out: string[];
  err: string[];
}

function captureIo(env: AiEnv): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  return {
    env,
    cwd: WORKSPACE_ROOT,
    stdout: (chunk) => out.push(chunk),
    stderr: (chunk) => err.push(chunk),
    now: () => new Date('2026-09-17T10:00:00.000Z'),
    out,
    err,
  };
}

describe('runEvalCommand', () => {
  let root: string;
  let evalsDir: string;
  let reportsDir: string;
  let fixturesDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lv-eval-cli-'));
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

  function dirs(): string[] {
    return [`--evals-dir=${evalsDir}`, `--reports-dir=${reportsDir}`];
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
  }

  it('Tarea desconocida', async () => {
    const io = captureIo({ NODE_ENV: 'test' });

    const code = await runEvalCommand(
      ['--task=no-existe', '--provider=mock', ...dirs()],
      io,
    );

    expect(code).toBe(EXIT_CODES.usage);
    expect(io.err.join('')).toContain('Unknown task "no-existe"');
    expect(io.err.join('')).toContain(
      `Evaluable tasks: ${evaluableTaskNames().join(', ')}`,
    );
  });

  describe('Proveedor externo sin permiso explícito', () => {
    let server: Server;
    let requests: number;

    beforeEach(async () => {
      requests = 0;
      server = createServer((_req, res) => {
        requests++;
        res.statusCode = 500;
        res.end();
      });
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    });

    afterEach(async () => {
      await new Promise<void>((done) => server.close(() => done()));
    });

    it('exits with code 2 without contacting any provider', async () => {
      const { port } = server.address() as AddressInfo;
      const io = captureIo({
        NODE_ENV: 'test',
        OPENROUTER_API_KEY: 'sk-or-test',
        OPENROUTER_MODEL: 'vendor/model:free',
        OPENROUTER_BASE_URL: `http://127.0.0.1:${String(port)}/api/v1`,
      });

      const code = await runEvalCommand(
        [`--task=${TASK}`, '--provider=openrouter', ...dirs()],
        io,
      );

      expect(code).toBe(EXIT_CODES.usage);
      expect(requests).toBe(0);
      expect(io.err.join('')).toContain('--allow-external');
      expect(io.err.join('')).not.toContain('sk-or-test');
    });
  });

  it('Caso con input inválido: exits with code 2 before running any case, naming line and id', async () => {
    await writeFile(
      goldenPath(evalsDir, TASK),
      `${JSON.stringify(GOLDEN[0])}\n${JSON.stringify({ ...GOLDEN[1], input: { text: '' } })}\n`,
    );
    // Sin fixtures: si se ejecutara algún caso, terminaría con código 3.
    const io = captureIo({ NODE_ENV: 'test', AI_FIXTURES_DIR: fixturesDir });

    const code = await runEvalCommand(
      [`--task=${TASK}`, '--provider=mock', ...dirs()],
      io,
    );

    expect(code).toBe(EXIT_CODES.usage);
    expect(io.err.join('')).toMatch(/line 2, id "en-01": invalid input/);
    expect(io.out).toEqual([]);
  });

  it('exits with code 2 on invalid AI configuration or arguments', async () => {
    const io = captureIo({ NODE_ENV: 'test' });
    await expect(
      runEvalCommand(
        [`--task=${TASK}`, '--provider=ollama', '--ollama-url=nope', ...dirs()],
        io,
      ),
    ).resolves.toBe(EXIT_CODES.usage);
    expect(io.err.join('')).toContain('OLLAMA_URL (invalid');

    await expect(
      runEvalCommand(['--provider=mock'], captureIo({})),
    ).resolves.toBe(EXIT_CODES.usage);
  });

  it('evaluates in replay, writes the baseline and the report, then matches it', async () => {
    await writeFixtures();
    const env = { NODE_ENV: 'test', AI_FIXTURES_DIR: fixturesDir };

    const update = captureIo(env);
    await expect(
      runEvalCommand(
        ['--all', '--provider=mock', '--update-baseline', ...dirs()],
        update,
      ),
    ).resolves.toBe(EXIT_CODES.success);
    expect(update.out.join('')).toContain('baseline updated');

    const check = captureIo(env);
    await expect(
      runEvalCommand([`--task=${TASK}`, '--provider=mock', ...dirs()], check),
    ).resolves.toBe(EXIT_CODES.success);
    expect(check.err).toEqual([]);
    expect(check.out.join('')).toContain(
      'classify-skills [mock]: 2 cases, 2 success, 0 degraded',
    );

    const report = await readFile(join(reportsDir, TASK, 'mock.md'), 'utf8');
    expect(report).toContain('| `es-01` | placeholder | success |');
    expect(report).toContain('golden set `placeholder`');
    expect(report).not.toContain('rrhh@example.com');
  });

  it('exits with code 1 without baseline and still writes the report', async () => {
    await writeFixtures();
    const io = captureIo({ NODE_ENV: 'test', AI_FIXTURES_DIR: fixturesDir });

    const code = await runEvalCommand(
      [`--task=${TASK}`, '--provider=mock', ...dirs()],
      io,
    );

    expect(code).toBe(EXIT_CODES.regression);
    expect(io.err.join('')).toContain(
      'nx run ai:eval --task=classify-skills --provider=mock --update-baseline',
    );
    await expect(
      readFile(join(reportsDir, TASK, 'mock.md'), 'utf8'),
    ).resolves.toContain('## Casos');
  });

  it('Fixture ausente en replay: exits with code 3 naming the case id and the key', async () => {
    const io = captureIo({ NODE_ENV: 'test', AI_FIXTURES_DIR: fixturesDir });

    const code = await runEvalCommand(
      [`--task=${TASK}`, '--provider=mock', ...dirs()],
      io,
    );

    const golden = await loadGolden(classifySkillsEvaluable, evalsDir);
    if (!golden.ok) throw new Error('invalid test golden');
    expect(code).toBe(EXIT_CODES.programming);
    expect(io.err.join('')).toContain('"es-01"');
    expect(io.err.join('')).toContain(golden.cases[0]?.key ?? 'missing');
  });
});

describe('Coherencia entre registro y golden sets', () => {
  let evalsDir: string;

  beforeEach(async () => {
    evalsDir = await mkdtemp(join(tmpdir(), 'lv-eval-coherence-'));
  });

  afterEach(async () => {
    await rm(evalsDir, { recursive: true, force: true });
  });

  it('detects registered tasks without golden set and golden sets without registered task', async () => {
    await mkdir(join(evalsDir, 'metrics'));
    await mkdir(join(evalsDir, 'extract-job'));
    await writeFile(join(evalsDir, 'extract-job', 'golden.jsonl'), '');
    await writeFile(join(evalsDir, 'golden.jsonl'), '');

    await expect(goldenTaskDirs(evalsDir)).resolves.toEqual(['extract-job']);
    await expect(registryCoherence(evalsDir)).resolves.toEqual({
      withoutGolden: ['classify-skills'],
      unregistered: ['extract-job'],
    });
  });

  it('is coherent when both sets are equal', async () => {
    for (const { task } of EVALUABLE_TASKS) {
      await mkdir(join(evalsDir, task.name));
      await writeFile(join(evalsDir, task.name, 'golden.jsonl'), '');
    }
    await expect(registryCoherence(evalsDir)).resolves.toEqual({
      withoutGolden: [],
      unregistered: [],
    });
  });

  // Pendiente de la tarea 5.1 de ai-eval-harness: `classify-skills/golden.jsonl` aún no existe en el repo. La 5.1 quita
  // el `skip` al escribir el golden set real.
  it.skip('Coherencia entre registro y golden sets: libs/ai/src/evals of the repository', async () => {
    await expect(registryCoherence(REAL_EVALS_DIR)).resolves.toEqual({
      withoutGolden: [],
      unregistered: [],
    });
  });
});
