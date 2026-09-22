import { z } from 'zod';
import { ProviderUnavailable } from '../../domain/errors';
import type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ProviderCapabilities,
} from '../../domain/ports/llm-provider.port';

// Proveedor Anthropic por HTTP con `fetch` nativo, sin SDK (ADR-032). Credencial solo en `x-api-key`.

export const ANTHROPIC_PROVIDER_ID = 'anthropic';
export const ANTHROPIC_API_VERSION = '2023-06-01';

const HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_TOKENS = 1024;

export interface AnthropicProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxContextTokens: number;
  /** Id efectivo (`anthropic` o `byok:<userId>:anthropic`). */
  id?: string;
}

const messagesResponseSchema = z.object({
  model: z.string().optional(),
  content: z
    .array(z.object({ type: z.literal('text'), text: z.string() }))
    .min(1),
  usage: z
    .object({
      input_tokens: z.number().int().nonnegative().optional(),
      output_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export class AnthropicProvider implements LlmProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  readonly #apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options: AnthropicProviderOptions) {
    this.id = options.id ?? ANTHROPIC_PROVIDER_ID;
    this.#apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.capabilities = {
      jsonMode: true,
      toolUse: false,
      maxContextTokens: options.maxContextTokens,
      external: true,
      costPer1kIn: 0,
      costPer1kOut: 0,
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const messages: { role: 'user'; content: string }[] = [
      { role: 'user', content: req.user },
    ];

    const body = {
      model: this.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      ...(req.system !== '' ? { system: req.system } : {}),
      ...(req.temperature !== undefined
        ? { temperature: req.temperature }
        : {}),
    };

    const startedAt = performance.now();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.#apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch {
      throw this.failure(req.signal);
    }

    if (!response.ok) {
      await discardBody(response);
      throw new ProviderUnavailable(this.id, response.status);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw this.failure(req.signal);
    }
    const latencyMs = Math.round(performance.now() - startedAt);

    const parsed = messagesResponseSchema.safeParse(payload);
    if (!parsed.success) throw new ProviderUnavailable(this.id);
    const textBlock = parsed.data.content.find(
      (block) => block.type === 'text',
    );
    if (textBlock === undefined) throw new ProviderUnavailable(this.id);

    return {
      text: textBlock.text,
      usage: {
        inputTokens: parsed.data.usage?.input_tokens ?? 0,
        outputTokens: parsed.data.usage?.output_tokens ?? 0,
      },
      model: parsed.data.model ?? this.model,
      latencyMs,
    };
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'x-api-key': this.#apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      await discardBody(response);
      return response.ok;
    } catch {
      return false;
    }
  }

  private failure(signal: AbortSignal | undefined): unknown {
    return signal?.aborted ? signal.reason : new ProviderUnavailable(this.id);
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // El cuerpo no interesa.
  }
}
