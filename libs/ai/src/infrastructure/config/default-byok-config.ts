import type { ByokProviderConfig } from './ai-config.schema';
import { AI_CONFIG_DEFAULTS } from './ai-config.schema';

/** Bloque `byok` de configuración con los defaults (tests y fixtures). */
export function defaultByokConfig(
  overrides: Partial<ByokProviderConfig> = {},
): ByokProviderConfig {
  return {
    anthropicBaseUrl: AI_CONFIG_DEFAULTS.BYOK_ANTHROPIC_BASE_URL,
    anthropicModel: AI_CONFIG_DEFAULTS.BYOK_ANTHROPIC_MODEL,
    anthropicMaxContextTokens:
      AI_CONFIG_DEFAULTS.BYOK_ANTHROPIC_MAX_CONTEXT_TOKENS,
    anthropicTimeoutMs: AI_CONFIG_DEFAULTS.BYOK_ANTHROPIC_TIMEOUT_MS,
    openaiBaseUrl: AI_CONFIG_DEFAULTS.BYOK_OPENAI_BASE_URL,
    openaiModel: AI_CONFIG_DEFAULTS.BYOK_OPENAI_MODEL,
    openaiMaxContextTokens: AI_CONFIG_DEFAULTS.BYOK_OPENAI_MAX_CONTEXT_TOKENS,
    openaiTimeoutMs: AI_CONFIG_DEFAULTS.BYOK_OPENAI_TIMEOUT_MS,
    openrouterBaseUrl: AI_CONFIG_DEFAULTS.BYOK_OPENROUTER_BASE_URL,
    openrouterModel: AI_CONFIG_DEFAULTS.BYOK_OPENROUTER_MODEL,
    openrouterMaxContextTokens:
      AI_CONFIG_DEFAULTS.BYOK_OPENROUTER_MAX_CONTEXT_TOKENS,
    openrouterTimeoutMs: AI_CONFIG_DEFAULTS.BYOK_OPENROUTER_TIMEOUT_MS,
    ...overrides,
  };
}
