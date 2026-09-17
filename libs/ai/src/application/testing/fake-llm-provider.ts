import type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ProviderCapabilities,
} from '../../domain/ports/llm-provider.port';

// Proveedor falso para tests de application (sin red). Responde con un guion de respuestas en orden y repite la
// última cuando se agota. Registra cada petición recibida.

export type FakeReply =
  | string
  | Error
  | ((request: CompletionRequest) => Promise<CompletionResult | string>);

export interface FakeLlmProviderOptions {
  capabilities?: Partial<ProviderCapabilities>;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
  latencyMs?: number;
}

export const FAKE_CAPABILITIES: ProviderCapabilities = {
  jsonMode: true,
  toolUse: false,
  maxContextTokens: 32_000,
  external: false,
  costPer1kIn: 0,
  costPer1kOut: 0,
};

export class FakeLlmProvider implements LlmProvider {
  readonly capabilities: ProviderCapabilities;
  readonly requests: CompletionRequest[] = [];
  private readonly model: string;
  private readonly usage: { inputTokens: number; outputTokens: number };
  private readonly latencyMs: number;

  constructor(
    readonly id: string,
    private readonly replies: readonly FakeReply[],
    options: FakeLlmProviderOptions = {},
  ) {
    if (replies.length === 0) throw new Error('FakeLlmProvider needs replies');
    this.capabilities = { ...FAKE_CAPABILITIES, ...options.capabilities };
    this.model = options.model ?? `${id}-model`;
    this.usage = options.usage ?? { inputTokens: 100, outputTokens: 20 };
    this.latencyMs = options.latencyMs ?? 5;
  }

  get calls(): number {
    return this.requests.length;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const index = Math.min(this.requests.length, this.replies.length - 1);
    this.requests.push(request);
    const reply = this.replies[index];
    if (reply instanceof Error) throw reply;
    const resolved = typeof reply === 'function' ? await reply(request) : reply;
    if (typeof resolved !== 'string') return resolved;
    return {
      text: resolved,
      usage: { ...this.usage },
      model: this.model,
      latencyMs: this.latencyMs,
    };
  }

  healthy(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
