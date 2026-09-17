import type { Redis } from 'ioredis';
import { z } from 'zod';
import type {
  CachedResult,
  ResultCache,
} from '../../domain/ports/result-cache.port';

// Caché de resultados exitosos en Redis (D8 de ai-gateway-core, ADR-018 §6), compartida entre procesos.
// Clave `ai:cache:v1:<key>`; valor con solo `{ output, providerId, model, promptVersion }`. Cualquier error de lectura,
// escritura o formato cuenta como fallo de caché: `get` devuelve `null` y `set` no lanza.

export const AI_CACHE_KEY_PREFIX = 'ai:cache:v1:';

/** `AI_CACHE_TTL_SECONDS` por defecto: 7 días. */
export const DEFAULT_AI_CACHE_TTL_SECONDS = 604_800;

export interface RedisResultCacheOptions {
  /** Admite fracciones: se guarda con `PX` en milisegundos (mínimo 1 ms). */
  ttlSeconds?: number;
}

const cachedResultSchema = z.object({
  output: z.unknown(),
  providerId: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
});

export function aiCacheKey(key: string): string {
  return `${AI_CACHE_KEY_PREFIX}${key}`;
}

export class RedisResultCache implements ResultCache {
  private readonly ttlMs: number;

  constructor(
    private readonly client: Pick<Redis, 'get' | 'set'>,
    options: RedisResultCacheOptions = {},
  ) {
    const ttlSeconds = options.ttlSeconds ?? DEFAULT_AI_CACHE_TTL_SECONDS;
    this.ttlMs = Math.max(1, Math.round(ttlSeconds * 1000));
  }

  async get(key: string): Promise<CachedResult | null> {
    try {
      const raw = await this.client.get(aiCacheKey(key));
      if (raw === null) return null;
      const parsed = cachedResultSchema.safeParse(JSON.parse(raw));
      if (!parsed.success || parsed.data.output === undefined) return null;
      return {
        output: parsed.data.output,
        providerId: parsed.data.providerId,
        model: parsed.data.model,
        promptVersion: parsed.data.promptVersion,
      };
    } catch {
      return null;
    }
  }

  async set(key: string, value: CachedResult): Promise<void> {
    // Lista cerrada de campos: nada más llega al almacén aunque el objeto traiga otros.
    const entry: CachedResult = {
      output: value.output,
      providerId: value.providerId,
      model: value.model,
      promptVersion: value.promptVersion,
    };
    try {
      await this.client.set(
        aiCacheKey(key),
        JSON.stringify(entry),
        'PX',
        this.ttlMs,
      );
    } catch {
      // Fallo de caché: la tarea sigue sin ella.
    }
  }
}
