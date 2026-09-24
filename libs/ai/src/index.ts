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
  EmbeddingCapabilities,
  EmbeddingProvider,
  EmbedRequest,
  EmbedResult,
  EmbedTrace,
} from './domain/ports/embedding-provider.port';
export {
  EMBED_OPERATION,
  MOCK_EMBEDDING_DIMENSIONS,
} from './domain/ports/embedding-provider.port';
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
export type {
  QuotaDecision,
  QuotaPolicy,
} from './domain/ports/quota-policy.port';
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
export type {
  AiLedgerTask,
  AiTask,
  AiTaskName,
  DataSensitivity,
  Rng,
} from './domain/task';
export {
  AiProgrammingError,
  FixtureMissing,
  InvalidDegradeOutput,
  InvalidFixture,
  InvalidPrompt,
  MockMisuse,
  ProviderUnavailable,
  SchemaViolation,
  SynthUnsupported,
} from './domain/errors';
export {
  AiModule,
  type AiModuleAsyncOptions,
  type AiModuleOptions,
} from './ai.module';
export {
  EMBED_TEXTS,
  PROVIDER_ELIGIBILITY,
  RUN_TASK,
  SECRET_VAULT,
  USER_AI_KEYS_REPOSITORY,
} from './ai.tokens';
export type { RunTaskFn } from './application/run-task.usecase';
export type {
  EmbedTextsFn,
  EmbedTextsResult,
  EmbedTextsSuccess,
  EmbedTextsDegraded,
} from './application/embed-texts.usecase';
export { EMBED_PROMPT_VERSION } from './application/embed-texts.usecase';
export type {
  ProviderEligibility,
  ProviderEligibilityQuery,
  ProviderEligibilityResult,
} from './application/provider-eligibility';
export type { SecretVault } from './domain/ports/secret-vault.port';
export {
  SecretTooShort,
  VaultDecryptFailed,
  VaultUnavailable,
} from './domain/ports/secret-vault.port';
export type {
  UpsertUserAiKeyInput,
  UserAiKeyRecord,
  UserAiKeysRepository,
  UserAiKeysWriteSession,
  UserAiKeyView,
} from './domain/ports/user-ai-keys.repository.port';
export {
  byokProviderId,
  isByokProviderId,
} from './infrastructure/providers/byok-provider.factory';
export { LibsodiumSecretVault } from './infrastructure/crypto/libsodium-secret-vault';
export { keyHintOf } from './infrastructure/crypto/key-hint';
export { InMemoryUserAiKeysRepository } from './application/testing/in-memory-user-ai-keys.repository';
export {
  classifySkillsTask,
  type ClassifySkillsInput,
  type ClassifySkillsOutput,
} from './tasks/classify-skills.task';
export {
  extractJobTask,
  EXTRACT_JOB_TEXT_MAX_LENGTH,
  type ExtractJobInput,
  type ExtractJobOutput,
} from './tasks/extract-job.task';
export {
  extractPastedJobTask,
  type ExtractPastedJobInput,
  type ExtractPastedJobOutput,
} from './tasks/extract-pasted-job.task';
export {
  matchCvTask,
  MATCH_CV_CV_TEXT_MAX_LENGTH,
  MATCH_CV_JOB_TEXT_MAX_LENGTH,
  MATCH_CV_TITLE_MAX_LENGTH,
  type MatchCvInput,
  type MatchCvOutput,
} from './tasks/match-cv.task';
export {
  critiqueSuggestionsTask,
  toCritiqueSuggestionsInput,
  type CritiqueSuggestionsInput,
  type CritiqueSuggestionsOutput,
  type CritiqueSourceJob,
  type CritiqueSourceReport,
} from './tasks/critique-suggestions.task';
export {
  buildRoadmapFromCatalogOnly,
  buildRoadmapTask,
  sampleBuildRoadmap,
  type BuildRoadmapInput,
  type BuildRoadmapOutput,
} from './tasks/build-roadmap.task';
export {
  isCatalogHit,
  searchCatalog,
  type CatalogResource,
} from './infrastructure/catalog/search-catalog';
export {
  formatAiConfigProblems,
  formatAiConfigWarnings,
  parseAiConfig,
  type AiEnv,
} from './infrastructure/config/parse-ai-config';
export { isOpenRouterModelUsable } from './infrastructure/config/ai-config.schema';
export type {
  AiConfig,
  AiConfigProblem,
  AiConfigResult,
  AiConfigWarning,
} from './infrastructure/config/ai-config.schema';
