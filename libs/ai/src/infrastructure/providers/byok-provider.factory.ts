import type { AiVendor } from '@linkvault/shared';
import type { AiLogger } from '../../domain/ports/ai-logger.port';
import type { LlmProvider } from '../../domain/ports/llm-provider.port';
import type { SecretVault } from '../../domain/ports/secret-vault.port';
import type { UserAiKeysRepository } from '../../domain/ports/user-ai-keys.repository.port';
import type { ByokProviderConfig } from '../config/ai-config.schema';
import {
  OPENROUTER_APP_REFERER,
  OPENROUTER_APP_TITLE,
} from '../config/ai-config.schema';
import { AnthropicProvider } from './anthropic.provider';
import { OpenAIProvider } from './openai.provider';
import { OpenRouterProvider } from './openrouter.provider';

// Construye proveedores `byok:<userId>:<vendor>` desde el vault (ADR-032 D3, D6, D8).
// Solo para el userId del contexto; descifrado solo en memoria de esta ejecución.

export const BYOK_PROVIDER_PREFIX = 'byok:';

export function byokProviderId(userId: string, vendor: AiVendor): string {
  return `${BYOK_PROVIDER_PREFIX}${userId}:${vendor}`;
}

export function isByokProviderId(providerId: string): boolean {
  return providerId.startsWith(BYOK_PROVIDER_PREFIX);
}

/** Resuelve proveedores BYOK del usuario sin contactar al vendor. */
export interface ByokProvidersSource {
  providersFor(userId: string | undefined): Promise<LlmProvider[]>;
}

export interface ByokProviderFactoryOptions {
  keys: UserAiKeysRepository;
  vault: SecretVault;
  config: ByokProviderConfig;
  logger: AiLogger;
}

/**
 * Resuelve los BYOK del usuario sin contactar al vendor. Un fallo al descifrar se omite
 * (se registra como warn) para no tumbar la cadena entera.
 */
export class ByokProviderFactory implements ByokProvidersSource {
  constructor(private readonly options: ByokProviderFactoryOptions) {}

  /**
   * Proveedores BYOK del `userId`, en orden de vendor. Vacío sin userId, sin vault o sin claves.
   */
  async providersFor(userId: string | undefined): Promise<LlmProvider[]> {
    if (userId === undefined || !this.options.vault.isAvailable()) {
      return [];
    }

    const records = await this.options.keys.listRecordsByUser(userId);
    const providers: LlmProvider[] = [];

    for (const record of records) {
      // Solo las claves de este userId (el repo ya filtra; defensa en profundidad).
      if (record.userId !== userId) continue;

      let apiKey: string;
      try {
        apiKey = await this.options.vault.decrypt(record.ciphertext);
      } catch (error) {
        this.options.logger.warn('BYOK key decrypt failed, skipping vendor', {
          vendor: record.vendor,
          error: error instanceof Error ? error.name : 'unknown',
        });
        continue;
      }

      const id = byokProviderId(userId, record.vendor);
      const built = this.buildProvider(record.vendor, id, apiKey);
      if (built !== null) providers.push(built);
    }

    return providers;
  }

  private buildProvider(
    vendor: AiVendor,
    id: string,
    apiKey: string,
  ): LlmProvider | null {
    const { config } = this.options;
    switch (vendor) {
      case 'anthropic':
        return new AnthropicProvider({
          id,
          apiKey,
          baseUrl: config.anthropicBaseUrl,
          model: config.anthropicModel,
          maxContextTokens: config.anthropicMaxContextTokens,
        });
      case 'openai':
        return new OpenAIProvider({
          id,
          apiKey,
          baseUrl: config.openaiBaseUrl,
          model: config.openaiModel,
          maxContextTokens: config.openaiMaxContextTokens,
        });
      case 'openrouter': {
        const model = config.openrouterModel;
        return new OpenRouterProvider({
          id,
          apiKey,
          baseUrl: config.openrouterBaseUrl,
          model,
          maxContextTokens: config.openrouterMaxContextTokens,
          referer: OPENROUTER_APP_REFERER,
          title: OPENROUTER_APP_TITLE,
          dataCollection: model.endsWith(':free') ? 'deny' : 'omit',
        });
      }
      default: {
        const _exhaustive: never = vendor;
        return _exhaustive;
      }
    }
  }
}
