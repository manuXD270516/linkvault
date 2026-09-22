import { z } from 'zod';
import { ProviderUnavailable } from '../../domain/errors';
import type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ProviderCapabilities,
} from '../../domain/ports/llm-provider.port';

// Proveedor OpenAI por HTTP con `fetch` nativo, sin SDK (ADR-032). Credencial solo en Authorization.

export const OPENAI_PROVIDER_ID = 'openai';

const HEALTH_TIMEOUT_MS = 5_000;

export interface OpenAIProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxContextTokens: number;
  /** Id efectivo (`openai` o `byok:<userId>:openai`). */
  id?: string;
}

const chatCompletionSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string() }) }))
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export class OpenAIProvider implements LlmProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  readonly #apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(options: OpenAIProviderOptions) {
    this.id = options.id ?? OPENAI_PROVIDER_ID;
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
    const messages: { role: 'system' | 'user'; content: string }[] = [];
    if (req.system !== '')
      messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.user });

    const body = {
      model: this.model,
      messages,
      ...(req.temperature !== undefined
        ? { temperature: req.temperature }
        : {}),
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      ...(req.responseFormat === 'json'
        ? { response_format: { type: 'json_object' } }
        : {}),
    };

    const startedAt = performance.now();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
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

    const parsed = chatCompletionSchema.safeParse(payload);
    if (!parsed.success) throw new ProviderUnavailable(this.id);
    const [choice] = parsed.data.choices;
    if (choice === undefined) throw new ProviderUnavailable(this.id);

    return {
      text: choice.message.content,
      usage: {
        inputTokens: parsed.data.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.data.usage?.completion_tokens ?? 0,
      },
      model: parsed.data.model ?? this.model,
      latencyMs,
    };
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.#apiKey}` },
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
