import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { AnyAiTask } from '../../application/task-registry';
import { FixtureMissing } from '../../domain/errors';
import { classifySkillsTask } from '../../tasks/classify-skills.task';
import {
  composeEvalRunTask,
  type ComposeEvalRunTaskOptions,
  type ComposeEvalRunTaskResult,
  type EvalRunTaskComposition,
} from './compose-run-task';

// Tarea 3.1: composición de `RunTask` para evaluar (D3 de ai-eval-harness).

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const TASKS: readonly AnyAiTask[] = [
  classifySkillsTask as unknown as AnyAiTask,
];

let emptyFixturesDir: string;

beforeAll(async () => {
  emptyFixturesDir = await mkdtemp(join(tmpdir(), 'lv-eval-compose-'));
});

afterAll(async () => {
  await rm(emptyFixturesDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function compose(
  overrides: Partial<ComposeEvalRunTaskOptions>,
): ComposeEvalRunTaskResult {
  return composeEvalRunTask({
    env: {},
    provider: 'mock',
    allowExternal: false,
    tasks: TASKS,
    cwd: WORKSPACE_ROOT,
    ...overrides,
  });
}

function valueOf(result: ComposeEvalRunTaskResult): EvalRunTaskComposition {
  if (!result.ok) throw new Error(`composition failed: ${result.error.kind}`);
  return result.value;
}

describe('composeEvalRunTask', () => {
  it('builds a RunTask with the mock in replay from the given env only, without reading .env or process.env', async () => {
    vi.stubEnv('AI_FIXTURES_DIR', '/somewhere/else');
    vi.stubEnv('AI_MOCK_MODE', 'synth');

    const { runTask, config } = valueOf(
      compose({
        env: { AI_MOCK_MODE: 'synth', AI_FIXTURES_DIR: emptyFixturesDir },
      }),
    );

    expect(config.nodeEnv).toBe('development');
    expect(config.chain).toEqual(['mock']);
    expect(config.mock).toEqual({
      mode: 'replay',
      fixturesDir: emptyFixturesDir,
    });
    // En synth sintetizaría; en replay, sin fixture, lanza.
    await expect(
      runTask.execute(
        classifySkillsTask,
        { text: 'TypeScript' },
        { aiConsent: { externalProviders: true } },
      ),
    ).rejects.toBeInstanceOf(FixtureMissing);
  });

  it('keeps NODE_ENV from the env and replaces AI_CHAIN with the provider', () => {
    const { config } = valueOf(
      compose({ env: { NODE_ENV: 'test', AI_CHAIN: 'ollama,openrouter' } }),
    );
    expect(config.nodeEnv).toBe('test');
    expect(config.chain).toEqual(['mock']);
  });

  it('overrides the Ollama URL and timeout with the flags', () => {
    const { config } = valueOf(
      compose({
        provider: 'ollama',
        env: {
          OLLAMA_URL: 'http://localhost:11434',
          OLLAMA_TIMEOUT_MS: '1000',
        },
        ollamaUrl: 'http://127.0.0.1:11435',
        timeoutMs: 300_000,
      }),
    );
    expect(config.chain).toEqual(['ollama']);
    expect(config.ollama).toMatchObject({
      baseUrl: 'http://127.0.0.1:11435',
      timeoutMs: 300_000,
    });
  });

  it('applies --timeout-ms to OPENROUTER_TIMEOUT_MS with openrouter and leaves the Ollama timeout alone', () => {
    const { config } = valueOf(
      compose({
        provider: 'openrouter',
        allowExternal: true,
        env: {
          NODE_ENV: 'test',
          OPENROUTER_API_KEY: 'sk-test',
          OPENROUTER_MODEL: 'vendor/model:free',
          OPENROUTER_TIMEOUT_MS: '1000',
          OLLAMA_TIMEOUT_MS: '2000',
        },
        timeoutMs: 45_000,
      }),
    );
    expect(config.openrouter?.timeoutMs).toBe(45_000);
    expect(config.ollama).toBeUndefined();

    const { config: ollama } = valueOf(
      compose({
        provider: 'ollama',
        env: { OPENROUTER_TIMEOUT_MS: '1000' },
        timeoutMs: 45_000,
      }),
    );
    expect(ollama.ollama?.timeoutMs).toBe(45_000);
  });

  it('ignores --timeout-ms with the mock', () => {
    const { config } = valueOf(compose({ timeoutMs: 45_000 }));
    expect(config.chain).toEqual(['mock']);
  });

  it('returns the configuration problems instead of throwing or exiting', () => {
    const result = compose({
      provider: 'ollama',
      ollamaUrl: 'not a url',
      timeoutMs: 0,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      kind: 'invalid_config',
      problems: [
        expect.objectContaining({ variable: 'OLLAMA_URL', problem: 'invalid' }),
        expect.objectContaining({
          variable: 'OLLAMA_TIMEOUT_MS',
          problem: 'invalid',
        }),
      ],
    });
  });

  it('rejects the mock with NODE_ENV=production as a configuration problem', () => {
    const result = compose({ env: { NODE_ENV: 'production' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('invalid_config');
  });

  it('refuses an external provider without explicit permission', () => {
    const env = {
      NODE_ENV: 'test',
      OPENROUTER_API_KEY: 'sk-test',
      OPENROUTER_MODEL: 'vendor/model:free',
    };

    expect(compose({ provider: 'openrouter', env })).toEqual({
      ok: false,
      error: { kind: 'external_not_allowed', providerId: 'openrouter' },
    });
    expect(
      compose({ provider: 'openrouter', env, allowExternal: true }).ok,
    ).toBe(true);
  });
});
