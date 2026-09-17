import type { TaskRegistry } from '../../application/task-registry';
import type { LlmProvider } from '../../domain/ports/llm-provider.port';
import type { AiConfig, AiProviderId } from '../config/ai-config.schema';
import { MockDeterministicProvider } from './mock-deterministic.provider';
import { OllamaProvider } from './ollama.provider';
import { OpenRouterProvider } from './openrouter.provider';

// Construye los proveedores de `AI_CHAIN` a partir de una configuración ya validada por `parseAiConfig` (D6, D12 de
// ai-gateway-core; ADR-014). Conserva el orden de la cadena (último desempate del routing) y devuelve los plazos por
// proveedor para `RunTaskDeps.providerTimeoutsMs`. `AI_CHAIN=none` produce una cadena vacía.

export interface ProviderRegistryDeps {
  /** De ella sale `task.sample` para el modo `synth` del mock. */
  tasks: Pick<TaskRegistry, 'get'>;
}

export interface BuiltProviders {
  providers: readonly LlmProvider[];
  /** Plazo por petición en ms; el mock no tiene (usa el valor por defecto de `runTask`). */
  timeoutsMs: Readonly<Record<string, number>>;
}

/** La configuración no trae el bloque de un proveedor de la cadena: no pasó por `parseAiConfig`. */
export class IncompleteProviderConfig extends Error {
  override readonly name = 'IncompleteProviderConfig';

  constructor(readonly providerId: AiProviderId) {
    super(
      `AI_CHAIN includes "${providerId}" but its configuration is missing; build the config with parseAiConfig`,
    );
  }
}

export type ProviderConfig = Pick<
  AiConfig,
  'chain' | 'mock' | 'ollama' | 'openrouter'
>;

export function buildProviders(
  config: ProviderConfig,
  deps: ProviderRegistryDeps,
): BuiltProviders {
  const providers: LlmProvider[] = [];
  const timeoutsMs: Record<string, number> = {};

  for (const id of config.chain) {
    switch (id) {
      case 'mock': {
        const mock = config.mock ?? missing(id);
        providers.push(
          new MockDeterministicProvider({
            mode: mock.mode,
            fixturesDir: mock.fixturesDir,
            tasks: deps.tasks,
          }),
        );
        break;
      }
      case 'ollama': {
        const ollama = config.ollama ?? missing(id);
        const provider = new OllamaProvider({
          baseUrl: ollama.baseUrl,
          model: ollama.model,
          maxContextTokens: ollama.maxContextTokens,
        });
        providers.push(provider);
        timeoutsMs[provider.id] = ollama.timeoutMs;
        break;
      }
      case 'openrouter': {
        const openrouter = config.openrouter ?? missing(id);
        const provider = new OpenRouterProvider({
          baseUrl: openrouter.baseUrl,
          apiKey: openrouter.apiKey,
          model: openrouter.model,
          maxContextTokens: openrouter.maxContextTokens,
          referer: openrouter.referer,
          title: openrouter.title,
        });
        providers.push(provider);
        timeoutsMs[provider.id] = openrouter.timeoutMs;
        break;
      }
    }
  }

  return { providers, timeoutsMs };
}

function missing(id: AiProviderId): never {
  throw new IncompleteProviderConfig(id);
}
