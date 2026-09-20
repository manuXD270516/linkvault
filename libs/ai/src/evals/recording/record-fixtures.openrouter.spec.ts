import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnyAiTask } from '../../application/task-registry';
import { classifySkillsTask } from '../../tasks/classify-skills.task';
import type { GoldenCase } from '../evaluable-task';
import { classifySkillsEvaluable } from '../evaluable-tasks';
import { parseGolden } from '../golden.schema';
import { composeEvalRunTask } from '../runner/compose-run-task';
import { StderrAiLogger } from '../runner/eval-ports';
import { PersonalTaskUpstreamRejected, recordFixtures } from './record-fixtures';

// Tarea 4.3: "Upstream externo con datos personales" y "Upstream externo sin permiso explícito" (requisito "Grabación de
// fixtures con un proveedor real", D7 de ai-eval-harness) con `composeEvalRunTask` real (`AI_CHAIN=openrouter`) contra
// un servidor node:http local que imita `POST /chat/completions`. El código 2 lo asigna el CLI (tarea 4.4).

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const TASKS: readonly AnyAiTask[] = [
  classifySkillsTask as unknown as AnyAiTask,
];
const API_KEY = 'sk-or-v1-record-test-0a1b2c3d4e5f';
const MODEL = 'meta-llama/llama-3.3-70b-instruct:free';
const EMAIL = 'ana.perez@example.com';

type SkillsCase = GoldenCase<{ text: string }, { skills: string[] }>;

function goldenCase(line: Record<string, unknown>): SkillsCase {
  const parsed = parseGolden(classifySkillsEvaluable, JSON.stringify(line));
  const [first] = parsed.ok ? parsed.cases : [];
  if (first === undefined) throw new Error('invalid test golden');
  return first;
}

const PERSONAL_CASE = goldenCase({
  id: 'es-email',
  input: { text: `Ana Pérez · ${EMAIL} · Backend con TypeScript` },
  expected: { skills: ['TypeScript'] },
  tags: ['placeholder'],
});

/** El modelo devuelve el marcador del email como si fuera una skill. */
const MARKED_OUTPUT = {
  skills: [
    { name: 'TypeScript', category: 'language' },
    { name: '[EMAIL_1]', category: 'other' },
  ],
};

interface LocalOpenRouter {
  baseUrl: string;
  /** Cuerpos crudos recibidos, tal como llegaron por la red. */
  bodies: string[];
  close(): Promise<void>;
}

async function startOpenRouter(): Promise<LocalOpenRouter> {
  const bodies: string[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'));
      if (req.method !== 'POST' || req.url !== '/api/v1/chat/completions') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: MODEL,
          choices: [{ message: { content: JSON.stringify(MARKED_OUTPUT) } }],
          usage: { prompt_tokens: 420, completion_tokens: 38 },
        }),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}/api/v1`,
    bodies,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/**
 * Mensaje `user` del cuerpo recibido. Se aísla porque el `system` de classify-skills v1 menciona `[EMAIL_1]` de forma
 * literal: buscarlo en el cuerpo entero no probaría la redacción.
 */
function userMessageOf(rawBody: string | undefined): string {
  const body = JSON.parse(rawBody ?? '{}') as {
    messages?: { role: string; content: string }[];
  };
  const user = body.messages?.find((message) => message.role === 'user');
  if (user === undefined) throw new Error('request without a user message');
  return user.content;
}

const silentLogger = new StderrAiLogger(() => undefined);

describe('recordFixtures against a local OpenRouter', () => {
  let fixturesDir: string;
  let openRouter: LocalOpenRouter;

  beforeEach(async () => {
    fixturesDir = await mkdtemp(join(tmpdir(), 'lv-eval-record-openrouter-'));
    openRouter = await startOpenRouter();
  });

  afterEach(async () => {
    await openRouter.close();
    await rm(fixturesDir, { recursive: true, force: true });
  });

  function compose(allowExternal: boolean) {
    return composeEvalRunTask({
      env: {
        NODE_ENV: 'test',
        AI_FIXTURES_DIR: fixturesDir,
        OPENROUTER_API_KEY: API_KEY,
        OPENROUTER_MODEL: MODEL,
        OPENROUTER_BASE_URL: openRouter.baseUrl,
      },
      provider: 'openrouter',
      allowExternal,
      tasks: TASKS,
      cwd: WORKSPACE_ROOT,
      logger: silentLogger,
    });
  }

  it('Upstream externo con datos personales', async () => {
    const composed = compose(true);
    if (!composed.ok) throw new Error(composed.error.kind);
    const { runTask, ledger } = composed.value;

    await expect(
      recordFixtures({
        evaluable: classifySkillsEvaluable,
        cases: [PERSONAL_CASE],
        runTask: runTask.execute,
        ledger,
        fixturesDir,
        upstream: 'openrouter',
        overwrite: false,
      }),
    ).rejects.toBeInstanceOf(PersonalTaskUpstreamRejected);
    expect(openRouter.bodies).toEqual([]);
    expect(await readdir(fixturesDir)).toEqual([]);
  });

  it('Upstream externo sin permiso explícito: fails with external_not_allowed without contacting the upstream', async () => {
    const composed = compose(false);

    expect(composed).toEqual({
      ok: false,
      error: { kind: 'external_not_allowed', providerId: 'openrouter' },
    });
    expect(openRouter.bodies).toEqual([]);
    expect(await readdir(fixturesDir)).toEqual([]);
  });
});
