import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
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
import {
  PersonalTaskUpstreamRejected,
  recordFixtures,
} from './record-fixtures';

// Tras 6.14, grabar una tarea `personal` contra Ollama se rechaza antes de contactar al proveedor.

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const TASKS: readonly AnyAiTask[] = [
  classifySkillsTask as unknown as AnyAiTask,
];

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

class FakeOllama {
  readonly requests: { method?: string; url?: string }[] = [];
  private server: Server | null = null;
  baseUrl = '';

  async listen(): Promise<void> {
    this.server = createServer((req, res) => {
      this.requests.push({ method: req.method, url: req.url });
      res.statusCode = 500;
      res.end('should not be contacted');
    });
    await new Promise<void>((done) =>
      this.server!.listen(0, '127.0.0.1', done),
    );
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${String(port)}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((done, fail) =>
      this.server?.close((error) => (error ? fail(error) : done())),
    );
  }
}

describe('recordFixtures against ollama (personal tasks)', () => {
  let fixturesDir: string;
  let ollama: FakeOllama;
  const silentLogger = new StderrAiLogger(() => undefined);

  beforeEach(async () => {
    fixturesDir = await mkdtemp(join(tmpdir(), 'lv-record-ollama-'));
    ollama = new FakeOllama();
    await ollama.listen();
  });

  afterEach(async () => {
    await ollama.close();
    await rm(fixturesDir, { recursive: true, force: true });
  });

  it('Grabar una tarea personal contra un proveedor real', async () => {
    const composed = composeEvalRunTask({
      env: { NODE_ENV: 'test', AI_FIXTURES_DIR: fixturesDir },
      provider: 'ollama',
      allowExternal: false,
      ollamaUrl: ollama.baseUrl,
      tasks: TASKS,
      cwd: WORKSPACE_ROOT,
      logger: silentLogger,
    });
    if (!composed.ok) throw new Error(composed.error.kind);

    await expect(
      recordFixtures({
        evaluable: classifySkillsEvaluable,
        cases: [CASE],
        runTask: composed.value.runTask.execute,
        ledger: composed.value.ledger,
        fixturesDir,
        upstream: 'ollama',
        overwrite: false,
      }),
    ).rejects.toBeInstanceOf(PersonalTaskUpstreamRejected);
    expect(ollama.requests).toEqual([]);
  });
});
