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

/**
 * Identidad de la ejecución (D4 de ai-gateway-core, ADR-018 §3). La usa el mock para localizar fixtures; los
 * proveedores reales la ignoran. Viaja fuera del texto del prompt.
 */
export interface CompletionTrace {
  taskName: string;
  promptVersion: string;
  /** sha256(canonicalJSON([taskName, promptVersion, outputLanguage, parsedInput])) */
  key: string;
  /**
   * Input ya parseado por `inputSchema`, antes de la redacción. Solo lo usa el modo `synth` del mock para llamar a
   * `task.sample`; ningún proveedor lo envía, registra ni persiste.
   */
  input?: unknown;
}

export interface CompletionRequest {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  signal?: AbortSignal;
  trace?: CompletionTrace;
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
