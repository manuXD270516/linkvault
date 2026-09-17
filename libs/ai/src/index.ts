export type {
  AiDegraded,
  AiResult,
  AiSuccess,
  DegradedReason,
} from './domain/ai-result';
export type { AiLogFields, AiLogger } from './domain/ports/ai-logger.port';
export type { CircuitBreaker } from './domain/ports/circuit-breaker.port';
export type { Clock } from './domain/ports/clock.port';
export type {
  CompletionRequest,
  CompletionResult,
  CompletionTrace,
  LlmProvider,
  ProviderCapabilities,
} from './domain/ports/llm-provider.port';
export type {
  PromptRef,
  PromptRegistry,
  PromptView,
  RenderedPrompt,
} from './domain/ports/prompt-registry.port';
export type { QuotaPolicy } from './domain/ports/quota-policy.port';
export type {
  CachedResult,
  ResultCache,
} from './domain/ports/result-cache.port';
export type {
  UsageLedger,
  UsageOutcome,
  UsageRecord,
} from './domain/ports/usage-ledger.port';
export type {
  AiConsent,
  OutputLanguage,
  RunContext,
} from './domain/run-context';
export type { AiTask, AiTaskName, DataSensitivity, Rng } from './domain/task';
export {
  AiProgrammingError,
  FixtureMissing,
  InvalidDegradeOutput,
  InvalidFixture,
  MockMisuse,
  ProviderUnavailable,
  SchemaViolation,
  SynthUnsupported,
} from './domain/errors';
