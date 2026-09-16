export type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ProviderCapabilities,
} from './domain/ports/llm-provider.port';
export type { AiTask, AiTaskName } from './domain/task';
export {
  FixtureMissing,
  ProviderUnavailable,
  QuotaExceeded,
  SchemaViolation,
} from './domain/errors';
