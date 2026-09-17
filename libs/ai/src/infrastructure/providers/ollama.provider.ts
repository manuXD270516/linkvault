import { z } from 'zod';
import { ProviderUnavailable } from '../../domain/errors';
import type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ProviderCapabilities,
} from '../../domain/ports/llm-provider.port';

// Proveedor local Ollama por HTTP con `fetch` nativo, sin SDK (D6 de ai-gateway-core, ADR-018 §12).
// La configuración validada con zod y los valores por defecto viven en infrastructure/config; aquí llegan explícitos.

export const OLLAMA_PROVIDER_ID = 'ollama';

/** Plazo de `healthy()`: una consulta de salud nunca debe quedarse colgada. */
const HEALTH_TIMEOUT_MS = 5_000;

export interface OllamaProviderOptions {
  /** p. ej. `http://localhost:11434`. */
  baseUrl: string;
  /** p. ej. `qwen2.5:7b`. */
  model: string;
  /** Se envía como `options.num_ctx` en cada petición. */
  maxContextTokens: number;
}

const chatResponseSchema = z.object({
  model: z.string().optional(),
  message: z.object({ content: z.string() }),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
});

interface OllamaChatMessage {
  role: 'system' | 'user';
  content: string;
}

export class OllamaProvider implements LlmProvider {
  readonly id = OLLAMA_PROVIDER_ID;
  readonly capabilities: ProviderCapabilities;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly maxContextTokens: number;

  constructor(options: OllamaProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.maxContextTokens = options.maxContextTokens;
    this.capabilities = {
      jsonMode: true,
      toolUse: false,
      maxContextTokens: options.maxContextTokens,
      external: false,
      costPer1kIn: 0,
      costPer1kOut: 0,
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const messages: OllamaChatMessage[] = [];
    if (req.system !== '')
      messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.user });

    const body = {
      model: this.model,
      messages,
      stream: false,
      ...(req.responseFormat === 'json' ? { format: 'json' } : {}),
      options: {
        num_ctx: this.maxContextTokens,
        ...(req.temperature !== undefined
          ? { temperature: req.temperature }
          : {}),
        ...(req.maxTokens !== undefined ? { num_predict: req.maxTokens } : {}),
      },
    };

    const startedAt = performance.now();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      // El mensaje de JSON.parse cita el cuerpo: nunca se propaga.
      throw this.failure(req.signal);
    }
    const latencyMs = Math.round(performance.now() - startedAt);

    const parsed = chatResponseSchema.safeParse(payload);
    if (!parsed.success) throw new ProviderUnavailable(this.id);

    return {
      text: parsed.data.message.content,
      usage: {
        inputTokens: parsed.data.prompt_eval_count ?? 0,
        outputTokens: parsed.data.eval_count ?? 0,
      },
      model: parsed.data.model ?? this.model,
      latencyMs,
    };
  }

  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/version`, {
        method: 'GET',
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      await discardBody(response);
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Una cancelación se propaga como tal (quien llama distingue su plazo); el resto, como proveedor no disponible. */
  private failure(signal: AbortSignal | undefined): unknown {
    return signal?.aborted ? signal.reason : new ProviderUnavailable(this.id);
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // El cuerpo no interesa; un error al descartarlo no cambia el resultado.
  }
}
