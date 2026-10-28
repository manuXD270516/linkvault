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

  it('exits with code 1 naming AI_CHAIN and the unknown provider in a single line', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ProcessExit(code);
    });
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    expect(() =>
      loadWorkerConfigOrExit({
        ...readEnvExample(),
        MONGO_URI: undefined,
        AI_CHAIN: 'mock,gpt-magic',
      }),
    ).toThrow(ProcessExit);

    expect(exit).toHaveBeenCalledWith(1);
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(String(stderr.mock.calls[0]?.[0])).toBe(
      '[worker] Invalid configuration, check these environment variables: MONGO_URI (missing), AI_CHAIN (invalid: unknown provider gpt-magic)\n',
    );
  });

  it('never prints the OpenRouter credential among AI problems', () => {
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ProcessExit(code);
    });
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const apiKey = 'openrouter-key-s3cr3t';

    expect(() =>
      loadWorkerConfigOrExit({
        ...readEnvExample(),
        AI_CHAIN: `openrouter,${apiKey}`,
        OPENROUTER_API_KEY: apiKey,
      }),
    ).toThrow(ProcessExit);

    const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('AI_CHAIN (invalid');
    expect(output).not.toContain(apiKey);
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

    const { config, ai } = loadWorkerConfigOrExit(readEnvExample());

    expect(exit).not.toHaveBeenCalled();
    expect(ai).toMatchObject({
      nodeEnv: 'development',
      chain: ['mock'],
      mock: { mode: 'synth' },
    });
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      WORKER_HEALTH_PORT: 3001,
      MONGO_URI: 'mongodb://localhost:27017/linkvault?directConnection=true',
      AI_CHAIN: 'mock',
      FEATURE_HEADLESS_EXTRACTION: false,
      FEATURE_GROUP_DIGEST: false,
      GROUP_DIGEST_CRON: '0 14 * * 1',
      ENRICH_FETCH_TIMEOUT_MS: 10_000,
      ENRICH_MAX_BYTES: 2_097_152,
      ENRICH_DOMAIN_DELAY_MS: 2_000,
      ENRICH_DEADLINE_MS: 45_000,
      ENRICH_ROBOTS_TTL_SECONDS: 43_200,
      ENRICH_USER_AGENT:
        'LinkVaultBot/0.1 (+https://github.com/manuXD270516/linkvault)',
      ENRICH_CONCURRENCY: 4,
      ENRICH_MAX_DEFERRALS: 600,
      S3_ENDPOINT: 'http://localhost:9000',
      S3_REGION: 'us-east-1',
      S3_SNAPSHOTS_BUCKET: 'snapshots',
      S3_BUCKET: 'cvs',
      CV_EXTRACTION_TIMEOUT_MS: 30_000,
      CV_EXTRACT_CONCURRENCY: 1,
      MATCH_ANALYSIS_TIMEOUT_MS: 120_000,
      MATCH_ANALYSIS_CONCURRENCY: 1,
      MATCH_ANALYSIS_MAX_AGE_MS: 240_000,
    });
  });

  it('requires the object storage variables, the CV bucket included', () => {
    const result = parseEnv(workerConfigSchema, {
      ...readEnvExample(),
      S3_ENDPOINT: undefined,
      S3_SNAPSHOTS_BUCKET: undefined,
      // Desde `cv-upload-extract` el worker lee el archivo del CV y lo borra: su bucket también es obligatorio.
      S3_BUCKET: undefined,
    });

    expect(result).toEqual({
      ok: false,
      invalid: [
        { name: 'S3_ENDPOINT', reason: 'missing' },
        { name: 'S3_SNAPSHOTS_BUCKET', reason: 'missing' },
        { name: 'S3_BUCKET', reason: 'missing' },
      ],
    });
  });

  it('requires the CV extraction variables', () => {
    const result = parseEnv(workerConfigSchema, {
      ...readEnvExample(),
      CV_EXTRACTION_TIMEOUT_MS: undefined,
      CV_EXTRACT_CONCURRENCY: undefined,
    });

    expect(result).toEqual({
      ok: false,
      invalid: [
        { name: 'CV_EXTRACTION_TIMEOUT_MS', reason: 'missing' },
        { name: 'CV_EXTRACT_CONCURRENCY', reason: 'missing' },
      ],
    });
  });

  it.each([
    ['CV_EXTRACTION_TIMEOUT_MS', '999'],
    ['CV_EXTRACTION_TIMEOUT_MS', '120001'],
    ['CV_EXTRACT_CONCURRENCY', '0'],
    ['CV_EXTRACT_CONCURRENCY', '5'],
    ['MATCH_ANALYSIS_TIMEOUT_MS', '999'],
    ['MATCH_ANALYSIS_TIMEOUT_MS', '300001'],
    ['MATCH_ANALYSIS_CONCURRENCY', '0'],
    ['MATCH_ANALYSIS_CONCURRENCY', '5'],
    ['MATCH_ANALYSIS_MAX_AGE_MS', '999'],
    ['MATCH_ANALYSIS_MAX_AGE_MS', '600001'],
  ])('rejects %s=%s naming the variable', (name, value) => {
    const result = parseEnv(workerConfigSchema, {
      ...readEnvExample(),
      [name]: value,
    });

    expect(result).toEqual({
      ok: false,
      invalid: [{ name, reason: 'invalid' }],
    });
  });

  it('refuses to start when MATCH_ANALYSIS_MAX_AGE_MS is not greater than the worker timeout', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new ProcessExit(code);
    });
    const stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    expect(() =>
      loadWorkerConfigOrExit({
        ...readEnvExample(),
        MATCH_ANALYSIS_MAX_AGE_MS: '30000',
        MATCH_ANALYSIS_TIMEOUT_MS: '60000',
      }),
    ).toThrow(ProcessExit);

    expect(exit).toHaveBeenCalledWith(1);
    const output = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
    expect(output).toContain('MATCH_ANALYSIS_MAX_AGE_MS');
    expect(output).toContain('MATCH_ANALYSIS_TIMEOUT_MS');
    expect(output).toContain('30000');
    expect(output).toContain('60000');
  });

  // Ramas de correo del `superRefine` (ADR-048 §2): el worker envía notificaciones de producto con el mismo
  // proveedor que `api`, así que exige lo mismo **al arrancar**. Antes de este change solo las comprobaba `api` y
  // un worker mal configurado arrancaba para fallar en el primer envío.
  it('requires SMTP host and port when MAIL_PROVIDER=smtp', () => {
    const result = parseEnv(workerConfigSchema, {
      ...readEnvExample(),
      MAIL_PROVIDER: 'smtp',
      MAIL_SMTP_HOST: undefined,
      MAIL_SMTP_PORT: undefined,
    });

    expect(result).toEqual({
      ok: false,
      invalid: [
        { name: 'MAIL_SMTP_HOST', reason: 'missing' },
        { name: 'MAIL_SMTP_PORT', reason: 'missing' },
      ],
    });
  });

  // Credenciales SMTP a medias (tarea 7.4/7.6 de staging-host, design D6): el arranque falla nombrando la que falta y
  // el mensaje no lleva el valor de la otra.
  it('Credenciales a medias impiden arrancar', () => {
    const result = parseEnv(workerConfigSchema, {
      ...readEnvExample(),
      MAIL_PROVIDER: 'smtp',
      MAIL_SMTP_USER: 'usuario-smtp-de-prueba',
      MAIL_SMTP_PASSWORD: undefined,
    });

    expect(result).toEqual({
      ok: false,
      invalid: [{ name: 'MAIL_SMTP_PASSWORD', reason: 'missing' }],
    });
    const message = result.ok
      ? ''
      : formatInvalidVariables('worker', result.invalid);
    expect(message).toContain('MAIL_SMTP_PASSWORD');
    expect(message).not.toContain('usuario-smtp-de-prueba');
  });

  it('SMTP con usuario y contraseña arranca, con STARTTLS por defecto', () => {
    const result = parseEnv(workerConfigSchema, {
      ...readEnvExample(),
      MAIL_PROVIDER: 'smtp',
      MAIL_SMTP_USER: 'usuario-smtp-de-prueba',
      MAIL_SMTP_PASSWORD: 'clave-smtp-de-prueba',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.MAIL_SMTP_SECURE).toBe(false);
    }
  });

  it('requires the Resend key when MAIL_PROVIDER=resend', () => {
    const result = parseEnv(workerConfigSchema, {
      ...readEnvExample(),
      MAIL_PROVIDER: 'resend',
      RESEND_API_KEY: undefined,
    });

    expect(result).toEqual({
      ok: false,
      invalid: [{ name: 'RESEND_API_KEY', reason: 'missing' }],
    });
  });

  it('asks for nothing else when MAIL_PROVIDER=capture', () => {
    const result = parseEnv(workerConfigSchema, {
      ...readEnvExample(),
      MAIL_PROVIDER: 'capture',
      MAIL_SMTP_HOST: undefined,
      MAIL_SMTP_PORT: undefined,
      RESEND_API_KEY: undefined,
    });

    expect(result.ok).toBe(true);
  });

  it('requires the enrichment variables', () => {
    const result = parseEnv(workerConfigSchema, {
      ...readEnvExample(),
      ENRICH_USER_AGENT: undefined,
      ENRICH_MAX_DEFERRALS: undefined,
    });

    expect(result).toEqual({
      ok: false,
      invalid: [
        { name: 'ENRICH_USER_AGENT', reason: 'missing' },
        { name: 'ENRICH_MAX_DEFERRALS', reason: 'missing' },
      ],
    });
  });

  it('rejects a link deadline shorter than a single download', () => {
    const result = parseEnv(workerConfigSchema, {
      ...readEnvExample(),
      ENRICH_FETCH_TIMEOUT_MS: '60000',
      ENRICH_DEADLINE_MS: '5000',
    });

    expect(result).toEqual({
      ok: false,
      invalid: [{ name: 'ENRICH_DEADLINE_MS', reason: 'invalid' }],
    });
  });

  it('keeps the courtesy delay between requests to the same host', () => {
    const result = parseEnv(workerConfigSchema, {
      ...readEnvExample(),
      ENRICH_DOMAIN_DELAY_MS: '0',
    });

    expect(result).toEqual({
      ok: false,
      invalid: [{ name: 'ENRICH_DOMAIN_DELAY_MS', reason: 'invalid' }],
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
