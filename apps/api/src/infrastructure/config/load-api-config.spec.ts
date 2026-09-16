import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv as parseDotenv } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiConfigSchema } from './api-config.schema';
import { parseEnv } from './env-parser';
import { loadApiConfigOrExit } from './load-api-config';

class ProcessExit extends Error {
  constructor(readonly code: string | number | null | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

const ENV_EXAMPLE = resolve(import.meta.dirname, '../../../../../.env.example');

function readEnvExample(): Record<string, string | undefined> {
  return parseDotenv(readFileSync(ENV_EXAMPLE, 'utf8'));
}

describe('api configuration', () => {
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
      loadApiConfigOrExit({
        ...example,
        MONGO_URI: undefined,
        API_PORT: secretLike,
      }),
    ).toThrow(ProcessExit);

    expect(exit).toHaveBeenCalledWith(1);
    const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('MONGO_URI (missing)');
    expect(output).toContain('API_PORT (invalid)');
    expect(output).not.toContain(secretLike);
    expect(output).not.toContain(example['REDIS_URL']);
  });

  it('treats an empty value as missing', () => {
    const result = parseEnv(apiConfigSchema, {
      ...readEnvExample(),
      REDIS_URL: '',
    });

    expect(result).toEqual({
      ok: false,
      invalid: [{ name: 'REDIS_URL', reason: 'missing' }],
    });
  });

  it('accepts .env.example unchanged', () => {
    const exit = vi.spyOn(process, 'exit');

    const config = loadApiConfigOrExit(readEnvExample());

    expect(exit).not.toHaveBeenCalled();
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 3000,
      MONGO_URI: 'mongodb://localhost:27017/linkvault?directConnection=true',
      AI_CHAIN: 'mock',
      AI_MOCK_MODE: 'replay',
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
