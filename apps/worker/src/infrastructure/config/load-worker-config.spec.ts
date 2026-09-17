import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv as parseDotenv } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatInvalidVariables, parseEnv } from './env-parser';
import { loadWorkerConfigOrExit } from './load-worker-config';
import { workerConfigSchema } from './worker-config.schema';

class ProcessExit extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

const ENV_EXAMPLE = resolve(import.meta.dirname, '../../../../../.env.example');

function readEnvExample(): Record<string, string | undefined> {
  return parseDotenv(readFileSync(ENV_EXAMPLE, 'utf8'));
}

describe('worker configuration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits with code 1 naming a missing variable without printing any value', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ProcessExit(code);
    });
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const secretLike = 'not-a-port-s3cr3t-value';
    const example = readEnvExample();

    expect(() =>
      loadWorkerConfigOrExit({
        ...example,
        MONGO_URI: undefined,
        WORKER_HEALTH_PORT: secretLike,
      }),
    ).toThrow(ProcessExit);

    expect(exit).toHaveBeenCalledWith(1);
    const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('MONGO_URI (missing)');
    expect(output).toContain('WORKER_HEALTH_PORT (invalid)');
    expect(output).not.toContain(secretLike);
    expect(output).not.toContain(example['REDIS_URL']);
  });

  it('requires WORKER_HEALTH_PORT', () => {
    const result = parseEnv(workerConfigSchema, {
      ...readEnvExample(),
      WORKER_HEALTH_PORT: undefined,
    });

    expect(result).toEqual({
      ok: false,
      invalid: [{ name: 'WORKER_HEALTH_PORT', reason: 'missing' }],
    });
  });

  it('accepts AI_CHAIN=none without AI_MOCK_MODE', () => {
    const result = parseEnv(workerConfigSchema, {
      ...readEnvExample(),
      AI_CHAIN: 'none',
      AI_MOCK_MODE: undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.config.AI_CHAIN).toBe('none');
  });

  it('prints the detail of an invalid variable', () => {
    expect(
      formatInvalidVariables('worker', [
        { name: 'MONGO_URI', reason: 'missing' },
        {
          name: 'AI_CHAIN',
          reason: 'invalid',
          detail: 'unknown provider gpt-magic',
        },
      ]),
    ).toBe(
      '[worker] Invalid configuration, check these environment variables: MONGO_URI (missing), AI_CHAIN (invalid: unknown provider gpt-magic)\n',
    );
  });

  it('accepts .env.example unchanged', () => {
    const exit = vi.spyOn(process, 'exit');

    const config = loadWorkerConfigOrExit(readEnvExample());

    expect(exit).not.toHaveBeenCalled();
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      WORKER_HEALTH_PORT: 3001,
      MONGO_URI: 'mongodb://localhost:27017/linkvault?directConnection=true',
      AI_CHAIN: 'mock',
      FEATURE_HEADLESS_EXTRACTION: false,
    });
  });

  it('keeps .env.example free of AI_PROVIDER and real-looking API keys', () => {
    const raw = readFileSync(ENV_EXAMPLE, 'utf8');

    expect(readEnvExample()).not.toHaveProperty('AI_PROVIDER');
    expect(raw).not.toMatch(/\bAI_PROVIDER\b/);
    // Prefijos de claves reales: OpenAI/OpenRouter (`sk-`), Anthropic (`sk-ant-`) y AWS (`AKIA`).
    expect(raw).not.toMatch(/(^|[^A-Za-z0-9])sk-/m);
    expect(raw).not.toContain('sk-ant-');
    expect(raw).not.toContain('AKIA');
  });
});
