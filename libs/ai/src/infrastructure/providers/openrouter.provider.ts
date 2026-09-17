import { z } from 'zod';
import { ProviderUnavailable } from '../../domain/errors';
import type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ProviderCapabilities,
} from '../../domain/ports/llm-provider.port';

// Proveedor externo OpenRouter por HTTP con `fetch` nativo, sin SDK (D6 de ai-gateway-core, ADR-018 §12).
// Solo modelos `:free` (lo valida la configuración), con `data_collection: "deny"`. La credencial viaja únicamente en
// la cabecera `Authorization`; los errores nunca llevan cuerpo, petición, cabeceras ni credencial, tampoco en `cause`.

export const OPENROUTER_PROVIDER_ID = 'openrouter';

/** Plazo de `healthy()`: una consulta de salud nunca debe quedarse colgada. */
const HEALTH_TIMEOUT_MS = 5_000;

export interface OpenRouterProviderOptions {
  /** p. ej. `https://openrouter.ai/api/v1`. */
  baseUrl: string;
  apiKey: string;
  /** Identificador terminado en `:free`. */
  model: string;
  maxContextTokens: number;
  /** Cabecera `HTTP-Referer` (atribución de la app en OpenRouter). */
  referer: string;
  /** Cabecera `X-Title`. */
  title: string;
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

export class OpenRouterProvider implements LlmProvider {
  readonly id = OPENROUTER_PROVIDER_ID;
  readonly capabilities: ProviderCapabilities;
  // Campo privado de ES: no aparece en JSON.stringify ni en util.inspect del proveedor.
  readonly #apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly referer: string;
  private readonly title: string;

  constructor(options: OpenRouterProviderOptions) {
    this.#apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.model = options.model;
    this.referer = options.referer;
    this.title = options.title;
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
      provider: { data_collection: 'deny' },
    };

    const startedAt = performance.now();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.referer,
          'X-Title': this.title,
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
      // El mensaje de JSON.parse cita el cuerpo: nunca se propaga.
      throw this.failure(req.signal);
    }
    const latencyMs = Math.round(performance.now() - startedAt);

    // OpenRouter puede responder 200 con `{ error }` en lugar de `choices`.
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

  /** Comprueba que la API responde a `GET /models`, sin credencial ni coste. */
  async healthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
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
