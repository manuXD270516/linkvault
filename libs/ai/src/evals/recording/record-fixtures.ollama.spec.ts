import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
import { caseContext } from '../runner/run-cases';
import { fixturePath, recordFixtures } from './record-fixtures';

// Tarea 4.2: "Grabar y reproducir" (requisito "Grabación de fixtures con un proveedor real", D7 de ai-eval-harness) con
// `composeEvalRunTask` real (`AI_CHAIN=ollama`) contra un servidor node:http local que imita `POST /api/chat` de Ollama.

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const TASKS: readonly AnyAiTask[] = [
  classifySkillsTask as unknown as AnyAiTask,
];
const MODEL = 'qwen2.5:7b';
const OUTPUT = {
  skills: [
    { name: 'TypeScript', category: 'language' },
    { name: 'Docker', category: 'tool' },
  ],
};

type SkillsCase = GoldenCase<{ text: string }, { skills: string[] }>;

function goldenCase(line: Record<string, unknown>): SkillsCase {
  const parsed = parseGolden(classifySkillsEvaluable, JSON.stringify(line));
  const [first] = parsed.ok ? parsed.cases : [];
  if (first === undefined) throw new Error('invalid test golden');
  return first;
}

const CASE = goldenCase({
  id: 'es-01',
  input: { text: 'Backend con TypeScript y Docker' },
  expected: { skills: ['TypeScript', 'Docker'] },
  tags: ['placeholder'],
});

interface LocalOllama {
  baseUrl: string;
  requests: { method: string; url: string }[];
  close(): Promise<void>;
}

async function startOllama(): Promise<LocalOllama> {
  const requests: { method: string; url: string }[] = [];
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '' });
      if (req.method !== 'POST' || req.url !== '/api/chat') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          model: MODEL,
          message: { role: 'assistant', content: JSON.stringify(OUTPUT) },
          done: true,
          prompt_eval_count: 310,
          eval_count: 42,
        }),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${String(port)}`,
    requests,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

const silentLogger = new StderrAiLogger(() => undefined);

describe('recordFixtures against a local Ollama', () => {
  let fixturesDir: string;
  let ollama: LocalOllama;

  beforeEach(async () => {
    fixturesDir = await mkdtemp(join(tmpdir(), 'lv-eval-record-ollama-'));
    ollama = await startOllama();
  });

  afterEach(async () => {
    await ollama.close();
    await rm(fixturesDir, { recursive: true, force: true });
  });

  function compose(provider: 'ollama' | 'mock') {
    const composed = composeEvalRunTask({
      env: { NODE_ENV: 'test', AI_FIXTURES_DIR: fixturesDir },
      provider,
      allowExternal: false,
      ...(provider === 'ollama' ? { ollamaUrl: ollama.baseUrl } : {}),
      tasks: TASKS,
      cwd: WORKSPACE_ROOT,
      logger: silentLogger,
    });
    if (!composed.ok) throw new Error(composed.error.kind);
    return composed.value;
  }

  it('Grabar y reproducir: the replay returns the recorded output without contacting Ollama', async () => {
    const recording = compose('ollama');

    const summary = await recordFixtures({
      evaluable: classifySkillsEvaluable,
      cases: [CASE],
      runTask: recording.runTask.execute,
      ledger: recording.ledger,
      fixturesDir,
      upstream: 'ollama',
      overwrite: false,
    });

    expect(summary).toEqual({ recorded: ['es-01'], skipped: [], failed: [] });
    expect(ollama.requests).toEqual([{ method: 'POST', url: '/api/chat' }]);
    const fixture = JSON.parse(
      await readFile(
        fixturePath(fixturesDir, 'classify-skills', CASE.key),
        'utf8',
      ),
    ) as unknown;
    expect(fixture).toEqual({
      source: `recorded:ollama:${MODEL}`,
      text: JSON.stringify(OUTPUT),
      model: MODEL,
      usage: { inputTokens: 310, outputTokens: 42 },
    });

    const replay = compose('mock');
    expect(replay.config.mock?.mode).toBe('replay');
    const result = await replay.runTask.execute(
      classifySkillsTask,
      CASE.input,
      caseContext(CASE),
    );

    expect(result).toEqual({
      status: 'success',
      output: OUTPUT,
      providerId: 'mock',
      model: MODEL,
      promptVersion: 'v1',
      cached: false,
    });
    expect(ollama.requests).toHaveLength(1);
  });
});
