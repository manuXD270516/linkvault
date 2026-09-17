// Tokens de inyección del módulo de IA (D12 de ai-gateway-core). Separados de `ai.module.ts` para que quien solo
// inyecta `runTask` no dependa del grafo de proveedores.

/** `RunTaskFn`: único punto de entrada del módulo de IA (ADR-014). */
export const RUN_TASK = Symbol('RUN_TASK');

/** `AiModuleOptions` resueltas por `forRootAsync`. */
export const AI_MODULE_OPTIONS = Symbol('AI_MODULE_OPTIONS');

/** Cliente ioredis de la caché de IA, o `null` si la cadena incluye el mock. Interno: no se exporta desde index.ts. */
export const AI_CACHE_REDIS_CLIENT = Symbol('AI_CACHE_REDIS_CLIENT');
