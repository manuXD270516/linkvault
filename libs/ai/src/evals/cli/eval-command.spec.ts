import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PENDING_FIXTURES_OFF,
  PENDING_FIXTURES_SWITCH_VAR,
} from '../../application/pending-fixtures';
import type { AiEnv } from '../../infrastructure/config/parse-ai-config';
import {
  buildRoadmapEvaluable,
  classifySkillsEvaluable,
  critiqueSuggestionsEvaluable,
  EVALUABLE_TASKS,
  evaluableTaskNames,
  extractJobEvaluable,
  extractPastedJobEvaluable,
  findEvaluableTask,
  matchCvEvaluable,
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
const OTHER_TASK = 'extract-job';
const PASTED_TASK = 'extract-pasted-job';
const MATCH_TASK = 'match-cv';
const CRITIQUE_TASK = 'critique-suggestions';
const ROADMAP_TASK = 'build-roadmap';

/** Golden mínimo de critique-suggestions (cv-suggestions-review 5.1). */
const CRITIQUE_GOLDEN = [
  {
    id: 'critique-01',
    input: {
      job: {
        title: 'Dev',
        text: 'TypeScript y NestJS.',
        skills: [
          { name: 'TypeScript', importance: 'must' },
          { name: 'NestJS', importance: 'must' },
        ],
      },
      report: {
        score: 70,
        matchedSkills: ['TypeScript'],
        missingSkills: [{ name: 'NestJS', importance: 'must' }],
        suggestions: [
          {
            section: 'skills',
            after: 'Incluir NestJS.',
            reason: 'Lo pide la vacante.',
            evidence: {
              jobRequirement: 'NestJS',
              importance: 'must',
            },
          },
        ],
      },
    },
    expected: {
      score: 0.5,
      issues: ['Las sugerencias son demasiado genéricas.'],
    },
    tags: ['placeholder'],
  },
];

/** Golden mínimo de build-roadmap (study-roadmap 2.1). */
const ROADMAP_GOLDEN = [
  {
    id: 'roadmap-01',
    input: {
      missingSkills: [{ name: 'Kafka', importance: 'must' }],
      job: {
        title: 'Backend',
        skills: [{ name: 'Kafka', importance: 'must' }],
      },
    },
    expected: {
      items: [
        {
          skill: 'Kafka',
          priority: 1,
          estimatedWeeks: 2,
          resources: [
            {
              type: 'doc',
              title: 'Apache Kafka Documentation',
              url: 'https://kafka.apache.org/documentation/',
              provider: 'kafka.apache.org',
              free: true,
              verified: true,
            },
          ],
        },
      ],
    },
    tags: ['placeholder'],
  },
];

/** Golden mínimo de la tercera: una conversación pegada que no es una vacante. */
const PASTED_GOLDEN = [
  {
    id: 'chat-01',
    input: { text: '¿Vienes el sábado? Sí, llevo la torta.' },
    expected: { isJobPosting: false },
    tags: ['placeholder'],
  },
];

/** Golden mínimo de match-cv: anonimizado + colisión de nombre (personalCvGolden). */
const MATCH_GOLDEN = [
  {
    id: 'cv-01',
    input: {
      job: {
        title: 'Dev',
        text: 'TypeScript.',
        skills: [{ name: 'TypeScript', importance: 'must' }],
      },
      cv: {
        text: 'Ana Paz Flores\nLa Paz\nConstructora Flores S.R.L.\nTypeScript',
      },
    },
    expected: {
      matchedSkills: ['TypeScript'],
      missingSkills: [],
      score: 100,
    },
    tags: ['anonymized', 'name-collision'],
    personName: 'Ana Paz Flores',
    pii: [{ type: 'name', value: 'Ana Paz Flores' }],
    skills: ['La Paz', 'Constructora Flores S.R.L.', 'TypeScript'],
  },
];

/** Golden mínimo de la segunda tarea evaluable, para que `--all` evalúe de verdad más de una. */
const OTHER_GOLDEN = [
  {
    id: 'listado-01',
    input: { text: 'Empleos en Bolivia. Busca por categoría y por ciudad.' },
    expected: { isJobPosting: false },
    tags: ['placeholder'],
  },
];

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
    await mkdir(join(evalsDir, OTHER_TASK), { recursive: true });
    await mkdir(join(fixturesDir, OTHER_TASK), { recursive: true });
    await writeFile(
      goldenPath(evalsDir, OTHER_TASK),
      `${OTHER_GOLDEN.map((line) => JSON.stringify(line)).join('\n')}\n`,
    );
    await mkdir(join(evalsDir, PASTED_TASK), { recursive: true });
    await mkdir(join(fixturesDir, PASTED_TASK), { recursive: true });
    await writeFile(
      goldenPath(evalsDir, PASTED_TASK),
      `${PASTED_GOLDEN.map((line) => JSON.stringify(line)).join('\n')}\n`,
    );
    await mkdir(join(evalsDir, MATCH_TASK), { recursive: true });
    await mkdir(join(fixturesDir, MATCH_TASK), { recursive: true });
    await writeFile(
      goldenPath(evalsDir, MATCH_TASK),
      `${MATCH_GOLDEN.map((line) => JSON.stringify(line)).join('\n')}\n`,
    );
    await writeFile(
      join(evalsDir, MATCH_TASK, 'known-gaps.json'),
      '{}\n',
    );
    await mkdir(join(evalsDir, CRITIQUE_TASK), { recursive: true });
    await mkdir(join(fixturesDir, CRITIQUE_TASK), { recursive: true });
    await writeFile(
      goldenPath(evalsDir, CRITIQUE_TASK),
      `${CRITIQUE_GOLDEN.map((line) => JSON.stringify(line)).join('\n')}\n`,
    );
    await mkdir(join(evalsDir, ROADMAP_TASK), { recursive: true });
    await mkdir(join(fixturesDir, ROADMAP_TASK), { recursive: true });
    await writeFile(
      goldenPath(evalsDir, ROADMAP_TASK),
      `${ROADMAP_GOLDEN.map((line) => JSON.stringify(line)).join('\n')}\n`,
    );
  });

  // "Fixture ausente en replay" espera el error a propósito: este archivo queda fuera del registro de pendientes (4.6).
  beforeEach(() => {
    vi.stubEnv(PENDING_FIXTURES_SWITCH_VAR, PENDING_FIXTURES_OFF);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  function dirs(): string[] {
    return [`--evals-dir=${evalsDir}`, `--reports-dir=${reportsDir}`];
  }

  /** Fixtures con las skills esperadas de cada caso, o las de `overrides` por `id`. */
  async function writeFixtures(overrides: Record<string, string[]> = {}) {
    const golden = await loadGolden(classifySkillsEvaluable, evalsDir);
    if (!golden.ok) throw new Error('invalid test golden');
    for (const goldenCase of golden.cases) {
      const skills = overrides[goldenCase.id] ?? goldenCase.expected.skills;
      await writeFile(
        join(fixturesDir, TASK, `${goldenCase.key}.json`),
        JSON.stringify({
          source: 'handwritten',
          text: JSON.stringify({
            skills: skills.map((name) => ({
              name,
              category: 'tool',
            })),
          }),
          model: 'fixture-model',
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
      );
    }
    await writeOtherFixtures();
  }

  /** Fixtures de extract-job, extract-pasted-job, match-cv, critique-suggestions y build-roadmap. */
  async function writeOtherFixtures() {
    const pages = await loadGolden(extractJobEvaluable, evalsDir);
    const pasted = await loadGolden(extractPastedJobEvaluable, evalsDir);
    const match = await loadGolden(matchCvEvaluable, evalsDir);
    const critique = await loadGolden(critiqueSuggestionsEvaluable, evalsDir);
    const roadmap = await loadGolden(buildRoadmapEvaluable, evalsDir);
    if (
      !pages.ok ||
      !pasted.ok ||
      !match.ok ||
      !critique.ok ||
      !roadmap.ok
    ) {
      throw new Error('invalid test golden');
    }
    const notAJob = JSON.stringify({
      source: 'handwritten',
      text: JSON.stringify({ isJobPosting: false, preview: null }),
      model: 'fixture-model',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    for (const goldenCase of pages.cases) {
      await writeFile(
        join(fixturesDir, OTHER_TASK, `${goldenCase.key}.json`),
        notAJob,
      );
    }
    for (const goldenCase of pasted.cases) {
      await writeFile(
        join(fixturesDir, PASTED_TASK, `${goldenCase.key}.json`),
        notAJob,
      );
    }
    const matchOutput = JSON.stringify({
      source: 'handwritten',
      text: JSON.stringify({
        score: 100,
        matchedSkills: ['TypeScript'],
        missingSkills: [],
        suggestions: [],
      }),
      model: 'fixture-model',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    for (const goldenCase of match.cases) {
      await writeFile(
        join(fixturesDir, MATCH_TASK, `${goldenCase.key}.json`),
        matchOutput,
      );
    }
    for (const goldenCase of critique.cases) {
      await writeFile(
        join(fixturesDir, CRITIQUE_TASK, `${goldenCase.key}.json`),
        JSON.stringify({
          source: 'handwritten',
          text: JSON.stringify(goldenCase.expected),
          model: 'fixture-model',
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
      );
    }
    for (const goldenCase of roadmap.cases) {
      await writeFile(
        join(fixturesDir, ROADMAP_TASK, `${goldenCase.key}.json`),
        JSON.stringify({
          source: 'handwritten',
          text: JSON.stringify(goldenCase.expected),
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
    // `--all` evalúa todas las tareas registradas, no solo la primera.
    expect(update.out.join('')).toContain('classify-skills [mock]');
    expect(update.out.join('')).toContain('extract-job [mock]');
    expect(update.out.join('')).toContain('extract-pasted-job [mock]');
    expect(update.out.join('')).toContain('match-cv [mock]');
    expect(update.out.join('')).toContain('build-roadmap [mock]');

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

  it('Evaluación en replay', async () => {
    // Centinela configurado como OLLAMA_URL: la cadena es solo el mock, así que no debe recibir ninguna petición.
    let requests = 0;
    const sentinel = createServer((_req, res) => {
      requests++;
      res.statusCode = 500;
      res.end();
    });
    await new Promise<void>((done) => sentinel.listen(0, '127.0.0.1', done));
    const { port } = sentinel.address() as AddressInfo;
    try {
      await writeFixtures();
      const env = {
        NODE_ENV: 'test',
        AI_FIXTURES_DIR: fixturesDir,
        OLLAMA_URL: `http://127.0.0.1:${String(port)}`,
      };
      await expect(
        runEvalCommand(
          [`--task=${TASK}`, '--provider=mock', '--update-baseline', ...dirs()],
          captureIo(env),
        ),
      ).resolves.toBe(EXIT_CODES.success);

      const io = captureIo(env);
      const code = await runEvalCommand(
        [`--task=${TASK}`, '--provider=mock', ...dirs()],
        io,
      );

      expect(code).toBe(EXIT_CODES.success);
      const report = await readFile(join(reportsDir, TASK, 'mock.md'), 'utf8');
      const caseRows = report
        .split('\n')
        .filter((line) => /^\| `(es|en)-01` \|/.test(line));
      expect(caseRows).toHaveLength(GOLDEN.length);
      expect(report).toContain(
        '| `schema_validity_rate` | bloqueante | 1 | 1 |',
      );
      expect(report).toContain('| `skills_recall` | bloqueante | 1 | 1 |');
      expect(report).toContain('golden set `placeholder`');
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((done) => sentinel.close(() => done()));
    }
  });

  it('Regresión de recall', async () => {
    await writeFixtures();
    const env = { NODE_ENV: 'test', AI_FIXTURES_DIR: fixturesDir };
    await expect(
      runEvalCommand(
        [`--task=${TASK}`, '--provider=mock', '--update-baseline', ...dirs()],
        captureIo(env),
      ),
    ).resolves.toBe(EXIT_CODES.success);
    // El fixture de es-01 pierde Docker: recall del caso 1/2, media (1/2 + 1) / 2.
    await writeFixtures({ 'es-01': ['TypeScript'] });

    const io = captureIo(env);
    const code = await runEvalCommand(
      [`--task=${TASK}`, '--provider=mock', ...dirs()],
      io,
    );

    expect(code).toBe(EXIT_CODES.regression);
    const stderr = io.err.join('');
    expect(stderr).toContain(
      '[classify-skills] skills_recall empeoró: actual 0.75, línea base 1',
    );
    expect(stderr).not.toContain('mejoró');
    expect(stderr).toContain(
      'nx run ai:eval --task=classify-skills --provider=mock --update-baseline',
    );
  });

  it('Casos con la misma clave de ejecución', async () => {
    await writeFile(
      goldenPath(evalsDir, TASK),
      `${[
        GOLDEN[0],
        GOLDEN[1],
        { ...GOLDEN[0], id: 'es-02', tags: ['placeholder', 'duplicado'] },
      ]
        .map((line) => JSON.stringify(line))
        .join('\n')}\n`,
    );
    // Sin fixtures: si se ejecutara algún caso, terminaría con código 3.
    const io = captureIo({ NODE_ENV: 'test', AI_FIXTURES_DIR: fixturesDir });

    const code = await runEvalCommand(
      [`--task=${TASK}`, '--provider=mock', ...dirs()],
      io,
    );

    expect(code).toBe(EXIT_CODES.usage);
    const stderr = io.err.join('');
    expect(stderr).toContain('id "es-02"');
    expect(stderr).toContain('same execution key as case "es-01"');
    expect(io.out).toEqual([]);
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
    // Nombre inventado: ya no vale `match-cv` porque ahora sí es evaluable.
    await mkdir(join(evalsDir, 'metrics'));
    await mkdir(join(evalsDir, 'future-task'));
    await writeFile(join(evalsDir, 'future-task', 'golden.jsonl'), '');
    await writeFile(join(evalsDir, 'golden.jsonl'), '');

    await expect(goldenTaskDirs(evalsDir)).resolves.toEqual(['future-task']);
    await expect(registryCoherence(evalsDir)).resolves.toEqual({
      withoutGolden: [
        'build-roadmap',
        'classify-skills',
        'critique-suggestions',
        'extract-job',
        'extract-pasted-job',
        'match-cv',
      ],
      unregistered: ['future-task'],
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

  it('Coherencia entre registro y golden sets: libs/ai/src/evals of the repository', async () => {
    await expect(registryCoherence(REAL_EVALS_DIR)).resolves.toEqual({
      withoutGolden: [],
      unregistered: [],
    });
  });

  it('findEvaluableTask finds match-cv, critique-suggestions and build-roadmap', () => {
    expect(findEvaluableTask('match-cv')?.task.name).toBe('match-cv');
    expect(findEvaluableTask('critique-suggestions')?.task.name).toBe(
      'critique-suggestions',
    );
    expect(findEvaluableTask('build-roadmap')?.task.name).toBe('build-roadmap');
    expect(evaluableTaskNames()).toContain('match-cv');
    expect(evaluableTaskNames()).toContain('critique-suggestions');
    expect(evaluableTaskNames()).toContain('build-roadmap');
  });
});
