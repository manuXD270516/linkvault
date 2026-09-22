import { z } from 'zod';
import { MOCK_EMBEDDING_DIMENSIONS } from '../../domain/ports/embedding-provider.port';
import type { AiLedgerTask, AiTaskName } from '../../domain/task';
import type { QuotaLimits } from '../quota/config-quota-policy';

// Configuración del módulo de IA (D6, D7, D8, D9 y D12 de ai-gateway-core; ADR-018 §2 y §12; ADR-036). Tipos de la
// configuración ya validada, valores por defecto y schemas por variable. Las reglas entre variables viven en
// `parse-ai-config.ts`.

export const KNOWN_PROVIDER_IDS = ['mock', 'ollama', 'openrouter'] as const;
export type AiProviderId = (typeof KNOWN_PROVIDER_IDS)[number];

export const AI_CHAIN_NONE = 'none';

export const MOCK_MODES = ['replay', 'synth'] as const;
export type AiMockMode = (typeof MOCK_MODES)[number];

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type AiNodeEnv = (typeof NODE_ENVS)[number];

/** Tareas/operaciones que admite `AI_QUOTAS`: LLM + `embed` (ADR-036). */
export const KNOWN_TASK_NAMES: readonly AiLedgerTask[] = [
  'extract-job',
  // Texto pegado por una persona (D2 y D5 de paste-job-description): cuota propia, independiente de `extract-job`.
  'extract-pasted-job',
  'match-cv',
  'critique-suggestions',
  'build-roadmap',
  'classify-skills',
  'embed',
];

/** @deprecated Prefer `KNOWN_TASK_NAMES`; se mantiene el alias tipado LLM-only en comentarios legacy. */
export type KnownLlmTaskName = AiTaskName;

export const AI_CONFIG_DEFAULTS = {
  AI_PROMPTS_DIR: 'libs/ai/src/infrastructure/prompts',
  AI_FIXTURES_DIR: 'libs/ai/src/infrastructure/fixtures',
  AI_CACHE_TTL_SECONDS: 604_800,
  OLLAMA_URL: 'http://localhost:11434',
  OLLAMA_MODEL: 'qwen2.5:7b',
  OLLAMA_MAX_CONTEXT_TOKENS: 8192,
  OLLAMA_TIMEOUT_MS: 60_000,
  OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  OPENROUTER_MAX_CONTEXT_TOKENS: 32_000,
  OPENROUTER_TIMEOUT_MS: 30_000,
  AI_EMBED_MODEL: 'nomic-embed-text',
  AI_EMBED_DIMENSIONS: MOCK_EMBEDDING_DIMENSIONS,
  AI_EMBED_TIMEOUT_MS: 30_000,
  BYOK_ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
  BYOK_ANTHROPIC_MODEL: 'claude-sonnet-4-20250514',
  BYOK_ANTHROPIC_MAX_CONTEXT_TOKENS: 200_000,
  BYOK_ANTHROPIC_TIMEOUT_MS: 60_000,
  BYOK_OPENAI_BASE_URL: 'https://api.openai.com/v1',
  BYOK_OPENAI_MODEL: 'gpt-4o-mini',
  BYOK_OPENAI_MAX_CONTEXT_TOKENS: 128_000,
  BYOK_OPENAI_TIMEOUT_MS: 60_000,
  BYOK_OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
  BYOK_OPENROUTER_MODEL: 'meta-llama/llama-3.3-70b-instruct:free',
  BYOK_OPENROUTER_MAX_CONTEXT_TOKENS: 32_000,
  BYOK_OPENROUTER_TIMEOUT_MS: 30_000,
} as const;

/**
 * Atribución de la app en OpenRouter (`HTTP-Referer`, `X-Title`). Constantes y no variables de entorno: identifican al
 * proyecto, no a un despliegue, igual que el `User-Agent` identificable de los extractores.
 */
export const OPENROUTER_APP_REFERER =
  'https://github.com/manuXD270516/linkvault';
export const OPENROUTER_APP_TITLE = 'LinkVault';

export interface MockProviderConfig {
  mode: AiMockMode;
  /** Absoluta. */
  fixturesDir: string;
}

export interface OllamaProviderConfig {
  baseUrl: string;
  model: string;
  maxContextTokens: number;
  timeoutMs: number;
}

export interface OpenRouterProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxContextTokens: number;
  timeoutMs: number;
  referer: string;
  title: string;
}

/** Modelos y plazos de proveedores construidos desde claves BYOK (ADR-032 D3). */
export interface ByokProviderConfig {
  anthropicBaseUrl: string;
  anthropicModel: string;
  anthropicMaxContextTokens: number;
  anthropicTimeoutMs: number;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiMaxContextTokens: number;
  openaiTimeoutMs: number;
  openrouterBaseUrl: string;
  openrouterModel: string;
  openrouterMaxContextTokens: number;
  openrouterTimeoutMs: number;
}

/** Configuración validada. Cada bloque de proveedor existe si el proveedor está en `chain` o `embedChain`. */
export interface AiConfig {
  nodeEnv: AiNodeEnv;
  /** Orden de `AI_CHAIN`; vacía con `AI_CHAIN=none`. */
  chain: readonly AiProviderId[];
  /** Orden de `AI_EMBED_CHAIN`; vacía con `none` o ausente (default). */
  embedChain: readonly AiProviderId[];
  /** Modelo de embeddings (`AI_EMBED_MODEL`); default `nomic-embed-text`. */
  embedModel: string;
  /** Dimensión fija documentada (`AI_EMBED_DIMENSIONS`); default 768. */
  embedDimensions: number;
  /** Plazo por petición de embed en ms. */
  embedTimeoutMs: number;
  /** Absoluta. */
  promptsDir: string;
  cacheTtlSeconds: number;
  quotas: QuotaLimits;
  /**
   * Clave de vault (32 bytes) o `undefined` si no hay / es inválida.
   * En producción `parseAiConfig` exige una clave válida.
   */
  vaultKey?: Uint8Array;
  /** Siempre presente: modelos BYOK con defaults (ADR-032 D3). */
  byok: ByokProviderConfig;
  mock?: MockProviderConfig;
  ollama?: OllamaProviderConfig;
  openrouter?: OpenRouterProviderConfig;
}

/** Problema de configuración. `detail` solo lleva identificadores o textos fijos, nunca valores de credenciales. */
export interface AiConfigProblem {
  variable: string;
  problem: 'missing' | 'invalid';
  detail?: string;
}

export type AiConfigResult =
  | { ok: true; config: AiConfig }
  | { ok: false; problems: readonly AiConfigProblem[] };

export const positiveIntSchema = z.coerce.number().int().positive();

export const httpUrlSchema = z
  .string()
  .regex(/^https?:\/\/\S+$/)
  .refine((value) => URL.canParse(value));
