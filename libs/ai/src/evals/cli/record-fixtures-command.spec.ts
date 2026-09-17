import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AiEnv } from '../../infrastructure/config/parse-ai-config';
import { classifySkillsEvaluable } from '../evaluable-tasks';
import { goldenPath, loadGolden } from '../golden.schema';
import { EXIT_CODES } from './args';
import type { CliIo } from './eval-command';
import {
  fixturesDirOf,
  runRecordFixturesCommand,
} from './record-fixtures-command';

// Tarea 4.4: CLI `nx run ai:record-fixtures` (D2, D6 y D7 de ai-eval-harness; requisito "Grabación de fixtures con un
// proveedor real", escenario "Grabación en producción").

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const CLI = join(import.meta.dirname, 'record-fixtures.ts');
const TSX_URL = pathToFileURL(
  createRequire(import.meta.url).resolve('tsx'),
).href;
const TASK = 'classify-skills';

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
    now: () => new Date(0),
    out,
    err,
  };
}

describe('runRecordFixturesCommand', () => {
  let root: string;
  let evalsDir: string;
  let fixturesDir: string;
  let server: Server;
  let requests: number;
  let ollamaUrl: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lv-record-cli-'));
    evalsDir = join(root, 'evals');
    fixturesDir = join(root, 'fixtures');
    await mkdir(join(evalsDir, TASK), { recursive: true });
    await writeFile(
      goldenPath(evalsDir, TASK),
      `${GOLDEN.map((line) => JSON.stringify(line)).join('\n')}\n`,
    );
    requests = 0;
    // Ollama que siempre falla: cuenta las peticiones para comprobar que no se contacta.
    server = createServer((_req, res) => {
      requests++;
      res.statusCode = 503;
      res.end();
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    ollamaUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    await rm(root, { recursive: true, force: true });
  });

  function argv(...extra: string[]): string[] {
    return [
      `--task=${TASK}`,
      '--upstream=ollama',
      `--ollama-url=${ollamaUrl}`,
      '--timeout-ms=5000',
      `--evals-dir=${evalsDir}`,
      ...extra,
    ];
  }

  it('Grabación en producción: exits with code 2 without contacting the upstream', async () => {
    const io = captureIo({
      NODE_ENV: 'production',
      AI_FIXTURES_DIR: fixturesDir,
    });

    await expect(runRecordFixturesCommand(argv(), io)).resolves.toBe(
      EXIT_CODES.usage,
    );
    expect(requests).toBe(0);
    expect(io.err.join('')).toContain('NODE_ENV=production');
    await expect(readdir(fixturesDir)).rejects.toThrow();
  });

  it('exits with code 2 for an unknown task', async () => {
    const unknown = captureIo({ NODE_ENV: 'test' });
    await expect(
      runRecordFixturesCommand(
        ['--task=no-existe', '--upstream=ollama', `--evals-dir=${evalsDir}`],
        unknown,
      ),
    ).resolves.toBe(EXIT_CODES.usage);
    expect(unknown.err.join('')).toContain('Unknown task "no-existe"');
    expect(requests).toBe(0);
  });

  it('Upstream externo sin permiso explícito', async () => {
    // El servidor centinela hace de OpenRouter: sin --allow-external no debe recibir ninguna petición.
    const external = captureIo({
      NODE_ENV: 'test',
      OPENROUTER_API_KEY: 'sk-or-test',
      OPENROUTER_MODEL: 'vendor/model:free',
      OPENROUTER_BASE_URL: `${ollamaUrl}/api/v1`,
    });
    await expect(
      runRecordFixturesCommand(
        [`--task=${TASK}`, '--upstream=openrouter', `--evals-dir=${evalsDir}`],
        external,
      ),
    ).resolves.toBe(EXIT_CODES.usage);
    expect(external.err.join('')).toContain('--allow-external');
    expect(requests).toBe(0);
  });

  it('exits with code 1 listing the cases that could not be recorded', async () => {
    const io = captureIo({ NODE_ENV: 'test', AI_FIXTURES_DIR: fixturesDir });

    await expect(runRecordFixturesCommand(argv(), io)).resolves.toBe(
      EXIT_CODES.regression,
    );

    const out = io.out.join('');
    expect(out).toContain(
      'classify-skills [ollama]: 0 recorded, 0 skipped, 2 failed',
    );
    expect(out).toContain('failed es-01: degraded (providers_failed)');
    expect(out).toContain('failed en-01: degraded (providers_failed)');
    expect(requests).toBeGreaterThan(0);
  });

  it('skips cases with an existing fixture without contacting the upstream', async () => {
    const golden = await loadGolden(classifySkillsEvaluable, evalsDir);
    if (!golden.ok) throw new Error('invalid test golden');
    await mkdir(join(fixturesDir, TASK), { recursive: true });
    for (const goldenCase of golden.cases) {
      await writeFile(join(fixturesDir, TASK, `${goldenCase.key}.json`), '{}');
    }
    const io = captureIo({ NODE_ENV: 'test', AI_FIXTURES_DIR: fixturesDir });

    await expect(runRecordFixturesCommand(argv(), io)).resolves.toBe(
      EXIT_CODES.success,
    );
    expect(requests).toBe(0);
    expect(io.out.join('')).toContain('0 recorded, 2 skipped, 0 failed');
  });

  it('resolves AI_FIXTURES_DIR like parseMock: variable or default, against the working directory', () => {
    expect(fixturesDirOf({ env: {}, cwd: WORKSPACE_ROOT })).toBe(
      join(WORKSPACE_ROOT, 'libs/ai/src/infrastructure/fixtures'),
    );
    expect(
      fixturesDirOf({ env: { AI_FIXTURES_DIR: '' }, cwd: WORKSPACE_ROOT }),
    ).toBe(join(WORKSPACE_ROOT, 'libs/ai/src/infrastructure/fixtures'));
    expect(
      fixturesDirOf({ env: { AI_FIXTURES_DIR: 'x/fixtures' }, cwd: root }),
    ).toBe(join(root, 'x/fixtures'));
    expect(
      fixturesDirOf({
        env: { AI_FIXTURES_DIR: fixturesDir },
        cwd: WORKSPACE_ROOT,
      }),
    ).toBe(fixturesDir);
  });

  it('Grabación en producción (child process with tsx)', async () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      TSX_TSCONFIG_PATH: join(WORKSPACE_ROOT, 'libs/ai/tsconfig.lib.json'),
      AI_FIXTURES_DIR: fixturesDir,
    };
    const systemRoot = process.env['SystemRoot'];
    if (systemRoot !== undefined) env['SystemRoot'] = systemRoot;

    const run = await new Promise<{ code: number | null; stderr: string }>(
      (done, fail) => {
        const child = spawn(
          process.execPath,
          ['--import', TSX_URL, CLI, ...argv()],
          { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let stderr = '';
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
          stderr += chunk;
        });
        child.on('error', fail);
        child.on('close', (code) => done({ code, stderr }));
      },
    );

    expect(run.code, run.stderr).toBe(2);
    expect(run.stderr).toContain('NODE_ENV=production');
    expect(requests).toBe(0);
  }, 60_000);
});
