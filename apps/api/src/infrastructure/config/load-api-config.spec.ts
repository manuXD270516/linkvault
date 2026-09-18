import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv as parseDotenv } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_JWT_SECRET_EXAMPLE, apiConfigSchema } from './api-config.schema';
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
      FEATURE_HEADLESS_EXTRACTION: false,
      AUTH_JWT_SECRET: AUTH_JWT_SECRET_EXAMPLE,
      AUTH_ACCESS_TOKEN_TTL_SECONDS: 900,
      AUTH_REFRESH_TTL_DAYS: 30,
      AUTH_REFRESH_MAX_DAYS: 90,
      OUTBOX_RELAY_ENABLED: true,
      OUTBOX_RELAY_INTERVAL_MS: 1000,
    });
  });

  it('accepts AI_CHAIN=none without AI_MOCK_MODE', () => {
    const result = parseEnv(apiConfigSchema, {
      ...readEnvExample(),
      AI_CHAIN: 'none',
      AI_MOCK_MODE: undefined,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.config.AI_CHAIN).toBe('none');
  });

  it('does not validate AI_MOCK_MODE, whose rule lives in parseAiConfig', () => {
    const result = parseEnv(apiConfigSchema, {
      ...readEnvExample(),
      AI_CHAIN: 'ollama',
      AI_MOCK_MODE: 'record',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.config).not.toHaveProperty('AI_MOCK_MODE');
  });

  it('Secreto corto', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ProcessExit(code);
    });
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const shortSecret = 'short-s3cr3t-20chars';

    expect(() =>
      loadApiConfigOrExit({
        ...readEnvExample(),
        AUTH_JWT_SECRET: shortSecret,
      }),
    ).toThrow(ProcessExit);

    expect(shortSecret).toHaveLength(20);
    expect(exit).toHaveBeenCalledWith(1);
    const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('AUTH_JWT_SECRET (invalid)');
    expect(output).not.toContain(shortSecret);
  });

  it('Secreto de ejemplo en producción', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ProcessExit(code);
    });
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    expect(() =>
      loadApiConfigOrExit({ ...readEnvExample(), NODE_ENV: 'production' }),
    ).toThrow(ProcessExit);

    expect(exit).toHaveBeenCalledWith(1);
    const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('AUTH_JWT_SECRET (invalid)');
    expect(output).not.toContain(AUTH_JWT_SECRET_EXAMPLE);
  });

  it('Máximo menor que la caducidad', () => {
    const result = parseEnv(apiConfigSchema, {
      ...readEnvExample(),
      AUTH_REFRESH_TTL_DAYS: '30',
      AUTH_REFRESH_MAX_DAYS: '20',
    });

    expect(result).toEqual({
      ok: false,
      invalid: [{ name: 'AUTH_REFRESH_MAX_DAYS', reason: 'invalid' }],
    });
  });

  it('uses the exported example secret in .env.example', () => {
    expect(readEnvExample()['AUTH_JWT_SECRET']).toBe(AUTH_JWT_SECRET_EXAMPLE);
  });

  it('accepts a non-example secret in production', () => {
    const result = parseEnv(apiConfigSchema, {
      ...readEnvExample(),
      NODE_ENV: 'production',
      AUTH_JWT_SECRET: 'x'.repeat(32),
    });

    expect(result.ok).toBe(true);
  });

  // `AUTH_REFRESH_MAX_DAYS=365` aísla el rango de `AUTH_REFRESH_TTL_DAYS` de la relación TTL <= máximo.
  it.each([
    ['AUTH_ACCESS_TOKEN_TTL_SECONDS', '59'],
    ['AUTH_ACCESS_TOKEN_TTL_SECONDS', '3601'],
    ['AUTH_REFRESH_TTL_DAYS', '0'],
    ['AUTH_REFRESH_TTL_DAYS', '91'],
    ['AUTH_REFRESH_MAX_DAYS', '366'],
    // El relay se enciende o se apaga con palabras, como FEATURE_HEADLESS_EXTRACTION: `1` no es un booleano.
    ['OUTBOX_RELAY_ENABLED', '1'],
    ['OUTBOX_RELAY_ENABLED', 'yes'],
    ['OUTBOX_RELAY_INTERVAL_MS', '99'],
    ['OUTBOX_RELAY_INTERVAL_MS', '300001'],
    ['OUTBOX_RELAY_INTERVAL_MS', '1000.5'],
  ])('rejects %s=%s naming the variable', (name, value) => {
    const result = parseEnv(apiConfigSchema, {
      ...readEnvExample(),
      AUTH_REFRESH_MAX_DAYS: '365',
      [name]: value,
    });

    expect(result).toEqual({
      ok: false,
      invalid: [{ name, reason: 'invalid' }],
    });
  });

  it.each([
    ['AUTH_ACCESS_TOKEN_TTL_SECONDS', '60'],
    ['AUTH_ACCESS_TOKEN_TTL_SECONDS', '3600'],
    ['AUTH_REFRESH_TTL_DAYS', '1'],
    ['AUTH_REFRESH_MAX_DAYS', '365'],
    ['OUTBOX_RELAY_INTERVAL_MS', '100'],
    ['OUTBOX_RELAY_INTERVAL_MS', '300000'],
  ])('accepts the limit %s=%s', (name, value) => {
    const result = parseEnv(apiConfigSchema, {
      ...readEnvExample(),
      [name]: value,
    });

    expect(result.ok).toBe(true);
  });

  it('accepts AUTH_REFRESH_MAX_DAYS equal to AUTH_REFRESH_TTL_DAYS', () => {
    const result = parseEnv(apiConfigSchema, {
      ...readEnvExample(),
      AUTH_REFRESH_TTL_DAYS: '90',
      AUTH_REFRESH_MAX_DAYS: '90',
    });

    expect(result.ok).toBe(true);
  });

  it('turns OUTBOX_RELAY_ENABLED into a boolean', () => {
    const result = parseEnv(apiConfigSchema, {
      ...readEnvExample(),
      OUTBOX_RELAY_ENABLED: 'false',
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.config.OUTBOX_RELAY_ENABLED).toBe(false);
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
