// Tokens de inyección del módulo de IA (D12 de ai-gateway-core; ADR-036). Separados de `ai.module.ts` para que quien
// solo inyecta `runTask` / `embedTexts` no dependa del grafo de proveedores.

/** `RunTaskFn`: punto de entrada LLM del módulo de IA (ADR-014). */
export const RUN_TASK = Symbol('RUN_TASK');

/** `EmbedTextsFn`: única puerta de embeddings (ADR-036). */
export const EMBED_TEXTS = Symbol('EMBED_TEXTS');

/**
 * Consulta de elegibilidad de solo lectura (`ProviderEligibility`). Exportada para que `api` pueda
 * decidir si reutilizar un análisis degradado sin ejecutar la tarea (cv-match-suggestions 4.4).
 */
export const PROVIDER_ELIGIBILITY = Symbol('PROVIDER_ELIGIBILITY');

/** `AiModuleOptions` resueltas por `forRootAsync`. */
export const AI_MODULE_OPTIONS = Symbol('AI_MODULE_OPTIONS');

/** Cliente ioredis de la caché de IA, o `null` si la cadena incluye el mock. Interno: no se exporta desde index.ts. */
export const AI_CACHE_REDIS_CLIENT = Symbol('AI_CACHE_REDIS_CLIENT');

/** Puerto `SecretVault` (BYOK). Exportado para el HTTP thin de api. */
export const SECRET_VAULT = Symbol('SECRET_VAULT');

/** Repositorio `user_ai_keys`. Exportado para el HTTP thin y el borrado de cuenta. */
export const USER_AI_KEYS_REPOSITORY = Symbol('USER_AI_KEYS_REPOSITORY');

/** Factory de proveedores `byok:*`. Interno al módulo salvo tests. */
export const BYOK_PROVIDER_FACTORY = Symbol('BYOK_PROVIDER_FACTORY');

/**
 * `ByokVendorAvailability`: ¿puede esta instancia construir el proveedor BYOK de un vendor? (ADR-048 §6-ter).
 *
 * Exportado para que `api` pueble el `available` del contrato de claves sin leer `AiConfig.byok` por su cuenta ni
 * reimplementar el criterio: es el mismo predicado que usa `ByokProviderFactory` para no construir el proveedor.
 */
export const BYOK_VENDOR_AVAILABILITY = Symbol('BYOK_VENDOR_AVAILABILITY');
