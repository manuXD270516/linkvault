// Contratos de proveedor de lenguaje (design-v0.2 §4.2, ADR-014). Solo tipos: sin implementación ni SDKs.

export interface ProviderCapabilities {
  /** Soporta respuesta JSON forzada. */
  jsonMode: boolean;
  toolUse: boolean;
  maxContextTokens: number;
  /** Sale del perímetro: activa redacción de PII y exige consentimiento. */
  external: boolean;
  /** 0 para mock/ollama. */
  costPer1kIn: number;
  costPer1kOut: number;
}

export interface CompletionRequest {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
  latencyMs: number;
}

export interface LlmProvider {
  /** 'mock' | 'ollama' | 'openrouter' | 'anthropic' | 'openai' | 'byok:<userId>:<vendor>' */
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  healthy(): Promise<boolean>;
}
