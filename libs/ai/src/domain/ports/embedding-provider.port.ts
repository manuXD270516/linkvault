// Puerto de embeddings (ADR-036, design D5 / C4). Solo tipos: sin SDKs ni HTTP.
// `embedTexts` es la única puerta de aplicación; este puerto lo implementan adaptadores en
// `infrastructure/providers`.

/** Dimensión fija del mock y de `nomic-embed-text` en V0 (documentada en ADR-036 / D5). */
export const MOCK_EMBEDDING_DIMENSIONS = 768;

/** Operación de ledger / cuota para embeddings (no es una AiTask LLM). */
export const EMBED_OPERATION = 'embed' as const;

export interface EmbeddingCapabilities {
  /** Siempre true: declara soporte de embeddings. */
  embeddings: true;
  /** Dimensionalidad de salida (fija por proveedor/modelo). */
  dimensions: number;
  /** Sale del perímetro: activa redacción de PII y exige consentimiento. */
  external: boolean;
  /** Coste estimado por 1k tokens de entrada; 0 para mock/ollama. */
  costPer1kTokens: number;
}

/**
 * Identidad de la petición de embed (análoga a `CompletionTrace`). El mock la usa para claves
 * deterministas; los proveedores reales la ignoran. Nunca viaja en el cuerpo HTTP.
 */
export interface EmbedTrace {
  /** Siempre `embed`. */
  operation: typeof EMBED_OPERATION;
  /** sha256 del input canónico (textos antes de redactar). */
  key: string;
  /**
   * Textos canónicos sin redactar. Solo el mock (replay/synth) los usa para derivar vectores;
   * ningún proveedor real los envía, registra ni persiste.
   */
  texts?: readonly string[];
}

export interface EmbedRequest {
  texts: readonly string[];
  signal?: AbortSignal;
  trace?: EmbedTrace;
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
  dimensions: number;
  usage: { inputTokens: number };
  latencyMs: number;
}

export interface EmbeddingProvider {
  /** 'mock' | 'ollama' | 'openrouter' */
  readonly id: string;
  readonly capabilities: EmbeddingCapabilities;
  embed(req: EmbedRequest): Promise<EmbedResult>;
  healthy(): Promise<boolean>;
}
