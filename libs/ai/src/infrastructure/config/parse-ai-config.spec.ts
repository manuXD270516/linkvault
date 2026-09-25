import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AI_CONFIG_DEFAULTS,
  OPENROUTER_APP_REFERER,
  OPENROUTER_APP_TITLE,
  type AiConfig,
  type AiConfigProblem,
  type AiConfigResult,
} from './ai-config.schema';
import { defaultByokConfig } from './default-byok-config';
import {
  formatAiConfigProblems,
  formatAiConfigWarnings,
  parseAiConfig,
  type AiEnv,
} from './parse-ai-config';

// Requisitos "Cadena limitada por configuración" y "Proveedor OpenRouter" (specs/ai/provider-routing), "Mock fuera de
// producción" (specs/ai/deterministic-mock) y D6–D9 y D12 de ai-gateway-core.

const CWD = resolve('/workspace/linkvault');
const API_KEY = 'sk-or-v1-0a1b2c3d4e5f60718293a4b5c6d7e8f9-secret';
const VAULT_KEY_B64 = Buffer.alloc(32, 7).toString('base64');

function parse(env: AiEnv): AiConfigResult {
  return parseAiConfig(env, { cwd: CWD });
}

function config(env: AiEnv): AiConfig {
  const result = parse(env);
  if (!result.ok) {
    throw new Error(
      `expected a valid config: ${JSON.stringify(result.problems)}`,
    );
  }
  return result.config;
}

function problems(env: AiEnv): readonly AiConfigProblem[] {
  const result = parse(env);
  if (result.ok) throw new Error('expected configuration problems');
  return result.problems;
}

/** Todo lo que puede llegar a un log o a stderr. */
function allText(found: readonly AiConfigProblem[]): string {
  return `${JSON.stringify(found)}\n${formatAiConfigProblems('worker', found)}`;
}

describe('parseAiConfig', () => {
  it('Sin IA configurada: AI_CHAIN=none is valid with an empty chain', () => {
    expect(config({ NODE_ENV: 'development', AI_CHAIN: 'none' })).toEqual({
      nodeEnv: 'development',
      chain: [],
      embedChain: [],
      embedModel: 'nomic-embed-text',
      embedDimensions: 768,
      embedTimeoutMs: 30_000,
      promptsDir: resolve(CWD, AI_CONFIG_DEFAULTS.AI_PROMPTS_DIR),
      cacheTtlSeconds: 604_800,
      quotas: {},
      byok: defaultByokConfig(),
    });
  });

  it('builds every provider block with the defaults of D6–D8', () => {
    expect(
      config({
        NODE_ENV: 'development',
        AI_CHAIN: 'mock,ollama,openrouter',
        AI_MOCK_MODE: 'synth',
        OPENROUTER_API_KEY: API_KEY,
        OPENROUTER_MODEL: 'cohere/north-mini-code:free',
      }),
    ).toEqual({
      nodeEnv: 'development',
      chain: ['mock', 'ollama', 'openrouter'],
      embedChain: [],
      embedModel: 'nomic-embed-text',
      embedDimensions: 768,
      embedTimeoutMs: 30_000,
      promptsDir: resolve(CWD, 'libs/ai/src/infrastructure/prompts'),
      cacheTtlSeconds: 604_800,
      quotas: {},
      byok: defaultByokConfig(),
      mock: {
        mode: 'synth',
        fixturesDir: resolve(CWD, 'libs/ai/src/infrastructure/fixtures'),
      },
      ollama: {
        baseUrl: 'http://localhost:11434',
        model: 'qwen2.5:7b',
        maxContextTokens: 8192,
        timeoutMs: 60_000,
      },
      openrouter: {
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: API_KEY,
        model: 'cohere/north-mini-code:free',
        maxContextTokens: 32_000,
        timeoutMs: 30_000,
        referer: OPENROUTER_APP_REFERER,
        title: OPENROUTER_APP_TITLE,
      },
    });
  });

  it('requires AI_VAULT_KEY in production and accepts a 32-byte base64 key', () => {
    expect(
      problems({
        NODE_ENV: 'production',
        AI_CHAIN: 'none',
      }).some((p) => p.variable === 'AI_VAULT_KEY' && p.problem === 'missing'),
    ).toBe(true);

    const parsed = config({
      NODE_ENV: 'production',
      AI_CHAIN: 'none',
      AI_VAULT_KEY: VAULT_KEY_B64,
    });
    expect(parsed.vaultKey).toEqual(new Uint8Array(32).fill(7));
  });

  it('rejects an AI_VAULT_KEY that is not 32 decoded bytes without echoing it', () => {
    const shortKey = Buffer.from('too-short').toString('base64');
    const found = problems({
      NODE_ENV: 'development',
      AI_CHAIN: 'none',
      AI_VAULT_KEY: shortKey,
    });
    expect(found.some((p) => p.variable === 'AI_VAULT_KEY')).toBe(true);
    expect(allText(found)).not.toContain(shortKey);
  });

  it('reads BYOK_*_MODEL overrides', () => {
    const parsed = config({
      NODE_ENV: 'development',
      AI_CHAIN: 'none',
      BYOK_OPENAI_MODEL: 'gpt-4o',
      BYOK_OPENROUTER_MODEL: 'anthropic/claude-sonnet-4',
    });
    expect(parsed.byok.openaiModel).toBe('gpt-4o');
    expect(parsed.byok.openrouterModel).toBe('anthropic/claude-sonnet-4');
  });

  // ADR-048 §6 y `ai/byok`: el aviso de arranque. Va aquí porque no existía canal de aviso — todo lo que
  // `parseAiConfig` sabía emitir abortaba el proceso.
  describe('avisos de configuración', () => {
    it('no avisa en el caso normal: el default del código es un modelo utilizable', () => {
      const result = parse({ NODE_ENV: 'development', AI_CHAIN: 'none' });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.warnings).toEqual([]);
      expect(result.config.byok.openrouterModel).toBe(
        AI_CONFIG_DEFAULTS.BYOK_OPENROUTER_MODEL,
      );
    });

    it('con BYOK_OPENROUTER_MODEL vacía y sin default avisa, y el parseo sigue siendo ok', () => {
      // `EnvReader` lee la cadena vacía como ausente y `parseByok` cae al default del código, así que con la
      // variable **vacía** el estado «sin modelo» solo se alcanza neutralizando también el default, que es lo que
      // hace este test. Por entorno sí se alcanza con un valor de solo espacios, que `EnvReader` no trata como
      // ausente e `isOpenRouterModelUsable` rechaza (receta en la cabecera de `apps/web-e2e/src/byok.spec.ts`).
      const original = AI_CONFIG_DEFAULTS.BYOK_OPENROUTER_MODEL;
      Object.defineProperty(AI_CONFIG_DEFAULTS, 'BYOK_OPENROUTER_MODEL', {
        value: '',
        configurable: true,
        writable: true,
      });
      try {
        const result = parse({
          NODE_ENV: 'development',
          AI_CHAIN: 'none',
          BYOK_OPENROUTER_MODEL: '',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.warnings).toHaveLength(1);
        expect(result.warnings[0]?.variable).toBe('BYOK_OPENROUTER_MODEL');
        const text = formatAiConfigWarnings('worker', result.warnings);
        expect(text).toContain('BYOK_OPENROUTER_MODEL');
        expect(text).toContain('openrouter');
      } finally {
        Object.defineProperty(AI_CONFIG_DEFAULTS, 'BYOK_OPENROUTER_MODEL', {
          value: original,
          configurable: true,
          writable: true,
        });
      }
    });

    it('el aviso no lleva ningún valor de configuración', () => {
      const original = AI_CONFIG_DEFAULTS.BYOK_OPENROUTER_MODEL;
      Object.defineProperty(AI_CONFIG_DEFAULTS, 'BYOK_OPENROUTER_MODEL', {
        value: '',
        configurable: true,
        writable: true,
      });
      try {
        const result = parse({
          NODE_ENV: 'development',
          AI_CHAIN: 'none',
          AI_VAULT_KEY: VAULT_KEY_B64,
          BYOK_OPENROUTER_MODEL: '',
          BYOK_OPENAI_MODEL: 'gpt-4o',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const text = `${JSON.stringify(result.warnings)}\n${formatAiConfigWarnings('api', result.warnings)}`;
        expect(text).not.toContain(VAULT_KEY_B64);
        expect(text).not.toContain('gpt-4o');
      } finally {
        Object.defineProperty(AI_CONFIG_DEFAULTS, 'BYOK_OPENROUTER_MODEL', {
          value: original,
          configurable: true,
          writable: true,
        });
      }
    });
  });

  it('reads explicit values, keeps the AI_CHAIN order and resolves relative dirs against cwd', () => {
    const absolute = resolve('/opt/prompts');
    const parsed = config({
      NODE_ENV: 'production',
      AI_CHAIN: 'openrouter,ollama',
      AI_VAULT_KEY: VAULT_KEY_B64,
      AI_PROMPTS_DIR: absolute,
      AI_CACHE_TTL_SECONDS: '60',
      AI_QUOTAS: 'classify-skills=100,extract-job=200',
      OLLAMA_URL: 'http://ollama:11434',
      OLLAMA_MODEL: 'llama3.1:8b',
      OLLAMA_MAX_CONTEXT_TOKENS: '16384',
      OLLAMA_TIMEOUT_MS: '90000',
      OPENROUTER_API_KEY: API_KEY,
      OPENROUTER_MODEL: 'qwen/qwen-2.5-72b-instruct:free',
      OPENROUTER_BASE_URL: 'https://proxy.example.com/v1',
      OPENROUTER_MAX_CONTEXT_TOKENS: '64000',
      OPENROUTER_TIMEOUT_MS: '15000',
    });

    expect(parsed.chain).toEqual(['openrouter', 'ollama']);
    expect(parsed.promptsDir).toBe(absolute);
    expect(parsed.cacheTtlSeconds).toBe(60);
    expect(parsed.quotas).toEqual({
      'classify-skills': 100,
      'extract-job': 200,
    });
    expect(parsed.ollama).toEqual({
      baseUrl: 'http://ollama:11434',
      model: 'llama3.1:8b',
      maxContextTokens: 16_384,
      timeoutMs: 90_000,
    });
    expect(parsed.openrouter).toMatchObject({
      baseUrl: 'https://proxy.example.com/v1',
      maxContextTokens: 64_000,
      timeoutMs: 15_000,
    });
    expect(parsed.mock).toBeUndefined();
    expect(
      config({
        NODE_ENV: 'test',
        AI_CHAIN: 'mock',
        AI_MOCK_MODE: 'replay',
        AI_FIXTURES_DIR: 'fixtures/ai',
      }).mock?.fixturesDir,
    ).toBe(resolve(CWD, 'fixtures/ai'));
  });

  it('accepts AI_EMBED_CHAIN independently of AI_CHAIN', () => {
    const parsed = config({
      NODE_ENV: 'test',
      AI_CHAIN: 'none',
      AI_EMBED_CHAIN: 'mock,ollama',
      AI_MOCK_MODE: 'replay',
      AI_EMBED_MODEL: 'nomic-embed-text',
      AI_EMBED_DIMENSIONS: '768',
    });
    expect(parsed.chain).toEqual([]);
    expect(parsed.embedChain).toEqual(['mock', 'ollama']);
    expect(parsed.embedModel).toBe('nomic-embed-text');
    expect(parsed.mock?.mode).toBe('replay');
    expect(parsed.ollama?.baseUrl).toBe('http://localhost:11434');
  });

  it('rejects mock on AI_EMBED_CHAIN in production', () => {
    expect(
      problems({
        NODE_ENV: 'production',
        AI_CHAIN: 'none',
        AI_VAULT_KEY: VAULT_KEY_B64,
        AI_EMBED_CHAIN: 'mock',
        AI_MOCK_MODE: 'replay',
      }),
    ).toContainEqual(
      expect.objectContaining({
        variable: 'AI_EMBED_CHAIN',
        detail: expect.stringContaining('mock'),
      }),
    );
  });

  it('accepts a quota for extract-pasted-job, separate from the one of extract-job', () => {
    expect(
      config({
        NODE_ENV: 'development',
        AI_CHAIN: 'none',
        AI_QUOTAS: 'extract-job=200,extract-pasted-job=20',
      }).quotas,
    ).toEqual({ 'extract-job': 200, 'extract-pasted-job': 20 });
  });

  it('treats empty strings as absent', () => {
    expect(
      config({
        NODE_ENV: 'development',
        AI_CHAIN: 'ollama',
        AI_QUOTAS: '',
        OLLAMA_URL: '',
        AI_MOCK_MODE: '',
      }).ollama?.baseUrl,
    ).toBe('http://localhost:11434');
    expect(problems({ NODE_ENV: 'development', AI_CHAIN: '' })).toEqual([
      expect.objectContaining({ variable: 'AI_CHAIN', problem: 'missing' }),
    ]);
  });

  it('Proveedor desconocido', () => {
    const found = problems({
      NODE_ENV: 'development',
      AI_CHAIN: 'mock,gpt-magic',
      AI_MOCK_MODE: 'replay',
    });

    expect(found).toEqual([
      {
        variable: 'AI_CHAIN',
        problem: 'invalid',
        detail: 'unknown provider gpt-magic',
      },
    ]);
    expect(formatAiConfigProblems('worker', found)).toContain('AI_CHAIN');
    expect(formatAiConfigProblems('worker', found)).toContain('gpt-magic');
  });

  it('rejects none combined with providers and duplicated providers', () => {
    expect(
      problems({ NODE_ENV: 'development', AI_CHAIN: 'none,ollama' }),
    ).toEqual([expect.objectContaining({ variable: 'AI_CHAIN' })]);
    expect(
      problems({ NODE_ENV: 'development', AI_CHAIN: 'ollama,ollama' }),
    ).toEqual([
      {
        variable: 'AI_CHAIN',
        problem: 'invalid',
        detail: 'duplicated provider ollama',
      },
    ]);
  });

  it('Proveedor externo sin credencial', () => {
    const found = problems({
      NODE_ENV: 'development',
      AI_CHAIN: 'openrouter',
      OPENROUTER_MODEL: 'cohere/north-mini-code:free',
    });

    expect(found).toEqual([
      expect.objectContaining({
        variable: 'OPENROUTER_API_KEY',
        problem: 'missing',
      }),
    ]);
  });

  it('Mock en producción', () => {
    const found = problems({
      NODE_ENV: 'production',
      AI_CHAIN: 'mock,openrouter',
      AI_VAULT_KEY: VAULT_KEY_B64,
      AI_MOCK_MODE: 'replay',
      OPENROUTER_API_KEY: API_KEY,
      OPENROUTER_MODEL: 'cohere/north-mini-code:free',
    });

    expect(found).toEqual([
      {
        variable: 'AI_CHAIN',
        problem: 'invalid',
        detail: 'mock is not allowed with NODE_ENV=production',
      },
    ]);
    expect(allText(found)).not.toContain(API_KEY);
  });

  it('Arranque en producción con el mock en la cadena', () => {
    const found = problems({
      NODE_ENV: 'production',
      AI_CHAIN: 'mock',
      AI_VAULT_KEY: VAULT_KEY_B64,
      AI_MOCK_MODE: 'synth',
    });

    expect(found).toContainEqual(
      expect.objectContaining({
        variable: 'AI_CHAIN',
        detail: expect.stringContaining('mock'),
      }),
    );
  });

  it('Producción sin mock con AI_MOCK_MODE heredado', () => {
    for (const mode of ['synth', 'record', 'garbage']) {
      expect(
        parse({
          NODE_ENV: 'production',
          AI_CHAIN: 'ollama',
          AI_VAULT_KEY: VAULT_KEY_B64,
          AI_MOCK_MODE: mode,
        }).ok,
      ).toBe(true);
    }
  });

  it('Modo no soportado', () => {
    expect(
      problems({ NODE_ENV: 'test', AI_CHAIN: 'mock', AI_MOCK_MODE: 'record' }),
    ).toEqual([
      {
        variable: 'AI_MOCK_MODE',
        problem: 'invalid',
        detail: 'use nx run ai:record-fixtures',
      },
    ]);
    expect(
      problems({ NODE_ENV: 'test', AI_CHAIN: 'mock', AI_MOCK_MODE: 'live' }),
    ).toEqual([
      expect.objectContaining({ variable: 'AI_MOCK_MODE', problem: 'invalid' }),
    ]);
    expect(problems({ NODE_ENV: 'test', AI_CHAIN: 'mock' })).toEqual([
      expect.objectContaining({ variable: 'AI_MOCK_MODE', problem: 'missing' }),
    ]);
  });

  it('Modelo de pago configurado', () => {
    const found = problems({
      NODE_ENV: 'development',
      AI_CHAIN: 'openrouter',
      OPENROUTER_API_KEY: API_KEY,
      OPENROUTER_MODEL: 'anthropic/claude-sonnet-4',
    });

    expect(found).toEqual([
      expect.objectContaining({
        variable: 'OPENROUTER_MODEL',
        problem: 'invalid',
      }),
    ]);
    expect(
      problems({
        NODE_ENV: 'development',
        AI_CHAIN: 'openrouter',
        OPENROUTER_API_KEY: API_KEY,
      }),
    ).toEqual([
      expect.objectContaining({
        variable: 'OPENROUTER_MODEL',
        problem: 'missing',
      }),
    ]);
  });

  it('rejects a non-https OpenRouter base URL outside NODE_ENV=test', () => {
    const env = {
      AI_CHAIN: 'openrouter',
      OPENROUTER_API_KEY: API_KEY,
      OPENROUTER_MODEL: 'cohere/north-mini-code:free',
      OPENROUTER_BASE_URL: 'http://127.0.0.1:4010/api/v1',
    };

    expect(problems({ ...env, NODE_ENV: 'development' })).toEqual([
      expect.objectContaining({
        variable: 'OPENROUTER_BASE_URL',
        problem: 'invalid',
      }),
    ]);
    expect(
      problems({
        ...env,
        NODE_ENV: 'production',
        AI_VAULT_KEY: VAULT_KEY_B64,
      }),
    ).toEqual([
      expect.objectContaining({
        variable: 'OPENROUTER_BASE_URL',
        problem: 'invalid',
      }),
    ]);
    expect(config({ ...env, NODE_ENV: 'test' }).openrouter?.baseUrl).toBe(
      'http://127.0.0.1:4010/api/v1',
    );
    expect(
      problems({ ...env, NODE_ENV: 'test', OPENROUTER_BASE_URL: 'ftp://x' }),
    ).toEqual([expect.objectContaining({ variable: 'OPENROUTER_BASE_URL' })]);
  });

  it.each([
    ['classify-skills'],
    ['classify-skills=abc'],
    ['classify-skills=10;extract-job=5'],
    ['unknown-task=10'],
    ['classify-skills=10,classify-skills=20'],
    ['classify-skills=-1'],
  ])('rejects AI_QUOTAS mal formado: %s', (quotas) => {
    expect(
      problems({
        NODE_ENV: 'development',
        AI_CHAIN: 'none',
        AI_QUOTAS: quotas,
      }),
    ).toEqual([
      expect.objectContaining({ variable: 'AI_QUOTAS', problem: 'invalid' }),
    ]);
  });

  it('rejects non-positive integers for numeric settings', () => {
    expect(
      problems({
        NODE_ENV: 'development',
        AI_CHAIN: 'ollama',
        AI_CACHE_TTL_SECONDS: '0',
        OLLAMA_MAX_CONTEXT_TOKENS: 'lots',
        OLLAMA_TIMEOUT_MS: '1.5',
      }).map((p) => p.variable),
    ).toEqual([
      'AI_CACHE_TTL_SECONDS',
      'OLLAMA_MAX_CONTEXT_TOKENS',
      'OLLAMA_TIMEOUT_MS',
    ]);
  });

  it('requires NODE_ENV', () => {
    expect(problems({ AI_CHAIN: 'none' })).toEqual([
      { variable: 'NODE_ENV', problem: 'missing' },
    ]);
  });

  it('never includes the credential in any problem or message', () => {
    const cases: AiEnv[] = [
      // Credencial pegada por error en AI_CHAIN.
      {
        NODE_ENV: 'production',
        AI_CHAIN: `openrouter,${API_KEY}`,
        OPENROUTER_API_KEY: API_KEY,
        OPENROUTER_MODEL: 'x:free',
      },
      // Credencial con forma de identificador corto.
      {
        NODE_ENV: 'production',
        AI_CHAIN: 'openrouter,sk-short-key',
        OPENROUTER_API_KEY: 'sk-short-key',
        OPENROUTER_MODEL: 'x:free',
      },
      {
        NODE_ENV: 'production',
        AI_CHAIN: 'mock,openrouter',
        AI_MOCK_MODE: 'record',
        OPENROUTER_API_KEY: API_KEY,
        OPENROUTER_MODEL: API_KEY,
        OPENROUTER_BASE_URL: `http://${API_KEY}.example.com`,
        AI_QUOTAS: API_KEY,
      },
    ];

    for (const env of cases) {
      const text = allText(problems(env));
      expect(text).not.toContain(API_KEY);
      expect(text).not.toContain('sk-short-key');
    }
  });
});
