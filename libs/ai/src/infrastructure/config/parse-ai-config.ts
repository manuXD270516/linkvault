import { isAbsolute, resolve } from 'node:path';
import type { AiTaskName } from '../../domain/task';
import type { QuotaLimits } from '../quota/config-quota-policy';
import {
  AI_CHAIN_NONE,
  AI_CONFIG_DEFAULTS,
  httpUrlSchema,
  KNOWN_PROVIDER_IDS,
  KNOWN_TASK_NAMES,
  MOCK_MODES,
  NODE_ENVS,
  OPENROUTER_APP_REFERER,
  OPENROUTER_APP_TITLE,
  positiveIntSchema,
  type AiConfig,
  type AiConfigProblem,
  type AiConfigResult,
  type AiMockMode,
  type AiNodeEnv,
  type AiProviderId,
  type MockProviderConfig,
  type OllamaProviderConfig,
  type OpenRouterProviderConfig,
} from './ai-config.schema';

// Valida la configuración de IA antes de crear Nest (D12 de ai-gateway-core, ADR-018 §2). Lee solo sus variables; una
// cadena vacía cuenta como ausente. Devuelve todos los problemas a la vez, sin valores recibidos: los `detail` llevan
// identificadores de `AI_CHAIN` o de tareas, o textos fijos, y nunca la credencial.

export type AiEnv = Readonly<Record<string, string | undefined>>;

export interface ParseAiConfigOptions {
  /** Base de las rutas relativas de prompts y fixtures. Por defecto `process.cwd()` (D7). */
  cwd?: string;
}

/** Identificadores que se pueden repetir en un mensaje: forma de identificador y longitud acotada. */
const ECHOABLE_IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function parseAiConfig(
  env: AiEnv,
  options: ParseAiConfigOptions = {},
): AiConfigResult {
  const cwd = options.cwd ?? process.cwd();
  const reader = new EnvReader(env);
  const problems: AiConfigProblem[] = [];
  const secrets = [reader.get('OPENROUTER_API_KEY')].filter(
    (value): value is string => value !== undefined,
  );

  const nodeEnv = parseNodeEnv(reader, problems);
  const chain = parseChain(reader, problems, secrets);

  if (chain !== null && nodeEnv === 'production' && chain.includes('mock')) {
    problems.push({
      variable: 'AI_CHAIN',
      problem: 'invalid',
      detail: 'mock is not allowed with NODE_ENV=production',
    });
  }

  const promptsDir = absolutePath(
    reader.get('AI_PROMPTS_DIR') ?? AI_CONFIG_DEFAULTS.AI_PROMPTS_DIR,
    cwd,
  );
  const cacheTtlSeconds = positiveInt(
    reader,
    problems,
    'AI_CACHE_TTL_SECONDS',
    AI_CONFIG_DEFAULTS.AI_CACHE_TTL_SECONDS,
  );
  const quotas = parseQuotas(reader, problems);

  const mock = chain?.includes('mock')
    ? parseMock(reader, problems, cwd)
    : undefined;
  const ollama = chain?.includes('ollama')
    ? parseOllama(reader, problems)
    : undefined;
  const openrouter = chain?.includes('openrouter')
    ? parseOpenRouter(reader, problems, nodeEnv)
    : undefined;

  if (problems.length > 0 || nodeEnv === null || chain === null) {
    return { ok: false, problems };
  }

  const config: AiConfig = {
    nodeEnv,
    chain,
    promptsDir,
    cacheTtlSeconds,
    quotas,
    ...(mock ? { mock } : {}),
    ...(ollama ? { ollama } : {}),
    ...(openrouter ? { openrouter } : {}),
  };
  return { ok: true, config };
}

/** Mensaje de arranque: variables, motivo y detalle, sin valores. */
export function formatAiConfigProblems(
  service: string,
  problems: readonly AiConfigProblem[],
): string {
  const list = problems
    .map(
      (p) =>
        `${p.variable} (${p.problem}${p.detail === undefined ? '' : `: ${p.detail}`})`,
    )
    .join(', ');
  return `[${service}] Invalid AI configuration, check these environment variables: ${list}\n`;
}

class EnvReader {
  constructor(private readonly env: AiEnv) {}

  get(name: string): string | undefined {
    const value = this.env[name];
    return value === '' ? undefined : value;
  }
}

function parseNodeEnv(
  reader: EnvReader,
  problems: AiConfigProblem[],
): AiNodeEnv | null {
  const value = reader.get('NODE_ENV');
  if (value === undefined) {
    problems.push({ variable: 'NODE_ENV', problem: 'missing' });
    return null;
  }
  if (!isOneOf(NODE_ENVS, value)) {
    problems.push({
      variable: 'NODE_ENV',
      problem: 'invalid',
      detail: `expected one of ${NODE_ENVS.join(', ')}`,
    });
    return null;
  }
  return value;
}

function parseChain(
  reader: EnvReader,
  problems: AiConfigProblem[],
  secrets: readonly string[],
): AiProviderId[] | null {
  const value = reader.get('AI_CHAIN');
  if (value === undefined) {
    problems.push({
      variable: 'AI_CHAIN',
      problem: 'missing',
      detail: `expected "${AI_CHAIN_NONE}" or a comma-separated list of ${KNOWN_PROVIDER_IDS.join(', ')}`,
    });
    return null;
  }
  if (value === AI_CHAIN_NONE) return [];

  const chain: AiProviderId[] = [];
  let valid = true;
  for (const raw of value.split(',')) {
    const id = raw.trim();
    if (id === AI_CHAIN_NONE) {
      valid = false;
      problems.push({
        variable: 'AI_CHAIN',
        problem: 'invalid',
        detail: `"${AI_CHAIN_NONE}" cannot be combined with other providers`,
      });
    } else if (!isOneOf(KNOWN_PROVIDER_IDS, id)) {
      valid = false;
      problems.push({
        variable: 'AI_CHAIN',
        problem: 'invalid',
        detail: `unknown provider ${echoIdentifier(id, secrets)}`,
      });
    } else if (chain.includes(id)) {
      valid = false;
      problems.push({
        variable: 'AI_CHAIN',
        problem: 'invalid',
        detail: `duplicated provider ${id}`,
      });
    } else {
      chain.push(id);
    }
  }
  return valid ? chain : null;
}

function parseMock(
  reader: EnvReader,
  problems: AiConfigProblem[],
  cwd: string,
): MockProviderConfig | undefined {
  const fixturesDir = absolutePath(
    reader.get('AI_FIXTURES_DIR') ?? AI_CONFIG_DEFAULTS.AI_FIXTURES_DIR,
    cwd,
  );
  const mode = reader.get('AI_MOCK_MODE');
  if (mode === undefined) {
    problems.push({
      variable: 'AI_MOCK_MODE',
      problem: 'missing',
      detail: `required when AI_CHAIN includes mock: ${MOCK_MODES.join(' or ')}`,
    });
    return undefined;
  }
  if (mode === 'record') {
    problems.push({
      variable: 'AI_MOCK_MODE',
      problem: 'invalid',
      detail: 'record: diferido a ai-eval-harness',
    });
    return undefined;
  }
  if (!isOneOf(MOCK_MODES, mode)) {
    problems.push({
      variable: 'AI_MOCK_MODE',
      problem: 'invalid',
      detail: `expected ${MOCK_MODES.join(' or ')}`,
    });
    return undefined;
  }
  return { mode: mode satisfies AiMockMode, fixturesDir };
}

function parseOllama(
  reader: EnvReader,
  problems: AiConfigProblem[],
): OllamaProviderConfig | undefined {
  const before = problems.length;
  const baseUrl = url(
    reader,
    problems,
    'OLLAMA_URL',
    AI_CONFIG_DEFAULTS.OLLAMA_URL,
    false,
  );
  const config: OllamaProviderConfig = {
    baseUrl,
    model: reader.get('OLLAMA_MODEL') ?? AI_CONFIG_DEFAULTS.OLLAMA_MODEL,
    maxContextTokens: positiveInt(
      reader,
      problems,
      'OLLAMA_MAX_CONTEXT_TOKENS',
      AI_CONFIG_DEFAULTS.OLLAMA_MAX_CONTEXT_TOKENS,
    ),
    timeoutMs: positiveInt(
      reader,
      problems,
      'OLLAMA_TIMEOUT_MS',
      AI_CONFIG_DEFAULTS.OLLAMA_TIMEOUT_MS,
    ),
  };
  return problems.length === before ? config : undefined;
}

function parseOpenRouter(
  reader: EnvReader,
  problems: AiConfigProblem[],
  nodeEnv: AiNodeEnv | null,
): OpenRouterProviderConfig | undefined {
  const before = problems.length;

  const apiKey = reader.get('OPENROUTER_API_KEY');
  if (apiKey === undefined) {
    problems.push({
      variable: 'OPENROUTER_API_KEY',
      problem: 'missing',
      detail: 'required when AI_CHAIN includes openrouter',
    });
  }

  const model = reader.get('OPENROUTER_MODEL');
  if (model === undefined) {
    problems.push({
      variable: 'OPENROUTER_MODEL',
      problem: 'missing',
      detail: 'required when AI_CHAIN includes openrouter; must end with :free',
    });
  } else if (!model.endsWith(':free')) {
    problems.push({
      variable: 'OPENROUTER_MODEL',
      problem: 'invalid',
      detail: 'only free models are allowed: must end with :free',
    });
  }

  const baseUrl = url(
    reader,
    problems,
    'OPENROUTER_BASE_URL',
    AI_CONFIG_DEFAULTS.OPENROUTER_BASE_URL,
    nodeEnv !== 'test',
  );
  const maxContextTokens = positiveInt(
    reader,
    problems,
    'OPENROUTER_MAX_CONTEXT_TOKENS',
    AI_CONFIG_DEFAULTS.OPENROUTER_MAX_CONTEXT_TOKENS,
  );
  const timeoutMs = positiveInt(
    reader,
    problems,
    'OPENROUTER_TIMEOUT_MS',
    AI_CONFIG_DEFAULTS.OPENROUTER_TIMEOUT_MS,
  );

  if (
    problems.length !== before ||
    apiKey === undefined ||
    model === undefined
  ) {
    return undefined;
  }
  return {
    baseUrl,
    apiKey,
    model,
    maxContextTokens,
    timeoutMs,
    referer: OPENROUTER_APP_REFERER,
    title: OPENROUTER_APP_TITLE,
  };
}

function parseQuotas(
  reader: EnvReader,
  problems: AiConfigProblem[],
): QuotaLimits {
  const value = reader.get('AI_QUOTAS');
  if (value === undefined) return {};

  const quotas: Partial<Record<AiTaskName, number>> = {};
  for (const raw of value.split(',')) {
    const entry = raw.trim();
    const match = /^([a-z0-9-]+)=(\d+)$/.exec(entry);
    if (match === null) {
      problems.push({
        variable: 'AI_QUOTAS',
        problem: 'invalid',
        detail: 'expected task=limit pairs separated by commas',
      });
      return {};
    }
    const [, task = '', limit = ''] = match;
    if (!isOneOf(KNOWN_TASK_NAMES, task)) {
      problems.push({
        variable: 'AI_QUOTAS',
        problem: 'invalid',
        detail: `unknown task ${echoIdentifier(task, [])}`,
      });
      return {};
    }
    if (quotas[task] !== undefined) {
      problems.push({
        variable: 'AI_QUOTAS',
        problem: 'invalid',
        detail: `duplicated task ${task}`,
      });
      return {};
    }
    quotas[task] = Number.parseInt(limit, 10);
  }
  return quotas;
}

function positiveInt(
  reader: EnvReader,
  problems: AiConfigProblem[],
  variable: string,
  fallback: number,
): number {
  const value = reader.get(variable);
  if (value === undefined) return fallback;
  const parsed = positiveIntSchema.safeParse(value);
  if (!parsed.success) {
    problems.push({
      variable,
      problem: 'invalid',
      detail: 'expected a positive integer',
    });
    return fallback;
  }
  return parsed.data;
}

function url(
  reader: EnvReader,
  problems: AiConfigProblem[],
  variable: string,
  fallback: string,
  requireHttps: boolean,
): string {
  const value = reader.get(variable) ?? fallback;
  if (!httpUrlSchema.safeParse(value).success) {
    problems.push({
      variable,
      problem: 'invalid',
      detail: 'expected an http(s) URL',
    });
    return fallback;
  }
  if (requireHttps && !value.startsWith('https://')) {
    problems.push({
      variable,
      problem: 'invalid',
      detail: 'must use https (http is only allowed with NODE_ENV=test)',
    });
    return fallback;
  }
  return value;
}

function absolutePath(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}

/** Repite un identificador solo si tiene forma de identificador y no coincide con ninguna credencial. */
function echoIdentifier(value: string, secrets: readonly string[]): string {
  if (
    ECHOABLE_IDENTIFIER.test(value) &&
    !secrets.some((secret) => secret.includes(value) || value.includes(secret))
  ) {
    return value;
  }
  return '(unprintable identifier)';
}

function isOneOf<T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return (values as readonly string[]).includes(value);
}
