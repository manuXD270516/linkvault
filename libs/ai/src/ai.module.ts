import {
  Module,
  type DynamicModule,
  type FactoryProvider,
  type ModuleMetadata,
  type Provider,
} from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Redis } from 'ioredis';
import type { Connection } from 'mongoose';
import {
  AI_CACHE_REDIS_CLIENT,
  AI_MODULE_OPTIONS,
  BYOK_PROVIDER_FACTORY,
  BYOK_VENDOR_AVAILABILITY,
  EMBED_TEXTS,
  PROVIDER_ELIGIBILITY,
  RUN_TASK,
  SECRET_VAULT,
  USER_AI_KEYS_REPOSITORY,
} from './ai.tokens';
import { EmbedTexts, type EmbedTextsFn } from './application/embed-texts.usecase';
import { NullResultCache } from './application/null-result-cache';
import {
  DefaultProviderEligibility,
  type ProviderEligibility,
} from './application/provider-eligibility';
import { RunTask, type RunTaskFn } from './application/run-task.usecase';
import { TaskRegistry, type AnyAiTask } from './application/task-registry';
import type { AiLogger } from './domain/ports/ai-logger.port';
import type { CircuitBreaker } from './domain/ports/circuit-breaker.port';
import type { Clock } from './domain/ports/clock.port';
import type { PromptRegistry } from './domain/ports/prompt-registry.port';
import type { QuotaPolicy } from './domain/ports/quota-policy.port';
import type { ResultCache } from './domain/ports/result-cache.port';
import type { SecretVault } from './domain/ports/secret-vault.port';
import type { UserAiKeysRepository } from './domain/ports/user-ai-keys.repository.port';
import { MOCK_PROVIDER_ID } from './domain/provider-ids';
import type { AiConfig } from './infrastructure/config/ai-config.schema';
import { LibsodiumSecretVault } from './infrastructure/crypto/libsodium-secret-vault';
import { NestAiLogger } from './infrastructure/logging/nest-ai-logger';
import { MongoUsageLedger } from './infrastructure/persistence/mongo-usage-ledger';
import { MongoUserAiKeysRepository } from './infrastructure/persistence/mongo-user-ai-keys.repository';
import { RedisResultCache } from './infrastructure/persistence/redis-result-cache';
import {
  AiCacheRedisConnection,
  createAiCacheRedisClient,
} from './infrastructure/persistence/redis-result-cache.client';
import { FilePromptRegistry } from './infrastructure/prompt-registry/file-prompt-registry';
import { ByokProviderFactory } from './infrastructure/providers/byok-provider.factory';
import {
  byokVendorAvailabilityOf,
  type ByokVendorAvailability,
} from './infrastructure/providers/byok-vendor-availability';
import { buildEmbeddingProviders } from './infrastructure/providers/embedding-provider-registry';
import {
  buildProviders,
  type BuiltProviders,
} from './infrastructure/providers/provider-registry';
import { ConfigQuotaPolicy } from './infrastructure/quota/config-quota-policy';
import { InMemoryCircuitBreaker } from './infrastructure/resilience/in-memory-circuit-breaker';
import { RedisCircuitBreaker } from './infrastructure/resilience/redis-circuit-breaker';
import { buildRoadmapTask } from './tasks/build-roadmap.task';
import { classifySkillsTask } from './tasks/classify-skills.task';
import { critiqueSuggestionsTask } from './tasks/critique-suggestions.task';
import { extractJobTask } from './tasks/extract-job.task';
import { extractPastedJobTask } from './tasks/extract-pasted-job.task';
import { matchCvTask } from './tasks/match-cv.task';

// `AiModule` (D8, D9 y D12 de ai-gateway-core; elegibilidad y breaker compartido de cv-match-suggestions; ADR-036).
// Compone runTask y embedTexts con sus adaptadores a partir de una configuración ya validada por `parseAiConfig`: no
// lee `process.env`. Usa la conexión Mongoose por defecto de la app (`getConnectionToken()`), así que quien lo importa
// debe registrar `MongooseModule.forRoot*`. Exporta `RUN_TASK`, `EMBED_TEXTS` y `PROVIDER_ELIGIBILITY`.

export interface AiModuleOptions {
  /** Resultado `ok` de `parseAiConfig`. */
  config: AiConfig;
  /** `REDIS_URL` de la app. Solo se conecta si la cadena usa la caché real (sin `mock`). */
  redisUrl: string;
}

export interface AiModuleAsyncOptions {
  imports?: ModuleMetadata['imports'];
  inject?: FactoryProvider['inject'];
  useFactory: (...args: never[]) => AiModuleOptions | Promise<AiModuleOptions>;
}

/**
 * Tareas registradas: `classify-skills`, `extract-job`, `extract-pasted-job`, `match-cv`,
 * `critique-suggestions` y `build-roadmap` (study-roadmap).
 */
export const AI_TASKS: readonly AnyAiTask[] = [
  classifySkillsTask as unknown as AnyAiTask,
  extractJobTask as unknown as AnyAiTask,
  extractPastedJobTask as unknown as AnyAiTask,
  matchCvTask as unknown as AnyAiTask,
  critiqueSuggestionsTask as unknown as AnyAiTask,
  buildRoadmapTask as unknown as AnyAiTask,
];

const AI_TASK_REGISTRY = Symbol('AI_TASK_REGISTRY');
const AI_PROMPT_REGISTRY = Symbol('AI_PROMPT_REGISTRY');
const AI_PROVIDERS = Symbol('AI_PROVIDERS');
const AI_EMBED_PROVIDERS = Symbol('AI_EMBED_PROVIDERS');
const AI_CLOCK = Symbol('AI_CLOCK');
const AI_LOGGER = Symbol('AI_LOGGER');
const AI_CACHE_REDIS_CONNECTION = Symbol('AI_CACHE_REDIS_CONNECTION');
const AI_RESULT_CACHE = Symbol('AI_RESULT_CACHE');
const AI_USAGE_LEDGER = Symbol('AI_USAGE_LEDGER');
const AI_QUOTA_POLICY = Symbol('AI_QUOTA_POLICY');
const AI_CIRCUIT_BREAKER = Symbol('AI_CIRCUIT_BREAKER');

const systemClock: Clock = { now: () => Date.now() };

function usesRealCache(config: AiConfig): boolean {
  return !config.chain.includes(MOCK_PROVIDER_ID);
}

/** Plazos por id de plataforma y por vendor BYOK (reutilizados vía `timeoutFor`). */
function providerTimeoutsMs(
  built: BuiltProviders,
  config: AiConfig,
): Record<string, number> {
  return {
    ...built.timeoutsMs,
    anthropic: config.byok.anthropicTimeoutMs,
    openai: config.byok.openaiTimeoutMs,
    openrouter:
      built.timeoutsMs['openrouter'] ?? config.byok.openrouterTimeoutMs,
  };
}

@Module({})
export class AiModule {
  static forRootAsync(options: AiModuleAsyncOptions): DynamicModule {
    const providers: Provider[] = [
      {
        provide: AI_MODULE_OPTIONS,
        inject: options.inject ?? [],
        useFactory: options.useFactory,
      },
      {
        provide: AI_TASK_REGISTRY,
        useFactory: () => new TaskRegistry(AI_TASKS),
      },
      {
        provide: AI_PROMPT_REGISTRY,
        inject: [AI_MODULE_OPTIONS, AI_TASK_REGISTRY],
        // Falla el arranque si falta el prompt de alguna tarea o sus metadatos no coinciden (D7, D12).
        useFactory: async (
          { config }: AiModuleOptions,
          tasks: TaskRegistry,
        ): Promise<PromptRegistry> => {
          const prompts = new FilePromptRegistry({
            promptsDir: config.promptsDir,
          });
          for (const task of tasks.list()) {
            await prompts.ensure({
              taskName: task.name,
              promptVersion: task.promptVersion,
            });
          }
          return prompts;
        },
      },
      {
        provide: AI_PROVIDERS,
        inject: [AI_MODULE_OPTIONS, AI_TASK_REGISTRY],
        useFactory: (
          { config }: AiModuleOptions,
          tasks: TaskRegistry,
        ): BuiltProviders => buildProviders(config, { tasks }),
      },
      {
        provide: AI_EMBED_PROVIDERS,
        inject: [AI_MODULE_OPTIONS],
        useFactory: ({ config }: AiModuleOptions) =>
          buildEmbeddingProviders(config),
      },
      { provide: AI_CLOCK, useValue: systemClock },
      { provide: AI_LOGGER, useFactory: (): AiLogger => new NestAiLogger() },
      {
        provide: SECRET_VAULT,
        inject: [AI_MODULE_OPTIONS],
        useFactory: ({ config }: AiModuleOptions): SecretVault =>
          new LibsodiumSecretVault({ vaultKey: config.vaultKey }),
      },
      {
        provide: USER_AI_KEYS_REPOSITORY,
        inject: [getConnectionToken()],
        useFactory: (connection: Connection): UserAiKeysRepository =>
          new MongoUserAiKeysRepository(connection),
      },
      {
        provide: BYOK_PROVIDER_FACTORY,
        inject: [
          USER_AI_KEYS_REPOSITORY,
          SECRET_VAULT,
          AI_MODULE_OPTIONS,
          AI_LOGGER,
        ],
        useFactory: (
          keys: UserAiKeysRepository,
          vault: SecretVault,
          { config }: AiModuleOptions,
          logger: AiLogger,
        ): ByokProviderFactory =>
          new ByokProviderFactory({
            keys,
            vault,
            config: config.byok,
            logger,
          }),
      },
      // Un solo predicado de disponibilidad por vendor (ADR-048 §6-ter): el mismo que usa la factory para no
      // construir el proveedor. Se publica para que `api` pueble el `available` del contrato de claves sin volver a
      // interpretar `config.byok` — dos lecturas de la misma configuración divergen en cuanto una cambie.
      {
        provide: BYOK_VENDOR_AVAILABILITY,
        inject: [AI_MODULE_OPTIONS],
        useFactory: ({ config }: AiModuleOptions): ByokVendorAvailability =>
          byokVendorAvailabilityOf(config.byok),
      },
      {
        provide: AI_CACHE_REDIS_CLIENT,
        inject: [AI_MODULE_OPTIONS],
        useFactory: ({ config, redisUrl }: AiModuleOptions): Redis | null =>
          usesRealCache(config) ? createAiCacheRedisClient(redisUrl) : null,
      },
      {
        // Nest llama a onModuleInit (connect sin esperar) y onApplicationShutdown (disconnect) de esta instancia.
        provide: AI_CACHE_REDIS_CONNECTION,
        inject: [AI_CACHE_REDIS_CLIENT, AI_LOGGER],
        useFactory: (
          client: Redis | null,
          logger: AiLogger,
        ): AiCacheRedisConnection | null =>
          client === null ? null : new AiCacheRedisConnection(client, logger),
      },
      {
        provide: AI_RESULT_CACHE,
        inject: [AI_MODULE_OPTIONS, AI_CACHE_REDIS_CLIENT],
        useFactory: (
          { config }: AiModuleOptions,
          client: Redis | null,
        ): ResultCache =>
          client === null
            ? new NullResultCache()
            : new RedisResultCache(client, {
                ttlSeconds: config.cacheTtlSeconds,
              }),
      },
      {
        provide: AI_USAGE_LEDGER,
        inject: [getConnectionToken()],
        useFactory: (connection: Connection): MongoUsageLedger =>
          new MongoUsageLedger(connection),
      },
      {
        provide: AI_QUOTA_POLICY,
        inject: [AI_MODULE_OPTIONS, AI_USAGE_LEDGER, AI_CLOCK, AI_LOGGER],
        useFactory: (
          { config }: AiModuleOptions,
          ledger: MongoUsageLedger,
          clock: Clock,
          logger: AiLogger,
        ): QuotaPolicy =>
          new ConfigQuotaPolicy({
            limits: config.quotas,
            counter: ledger,
            clock,
            logger,
          }),
      },
      {
        // Breaker compartido cuando hay Redis de caché (cadena sin mock); InMemory si no (tests / sin Redis).
        provide: AI_CIRCUIT_BREAKER,
        inject: [AI_CLOCK, AI_CACHE_REDIS_CLIENT],
        useFactory: (
          clock: Clock,
          redis: Redis | null,
        ): CircuitBreaker =>
          redis === null
            ? new InMemoryCircuitBreaker(clock)
            : new RedisCircuitBreaker(redis, clock),
      },
      {
        provide: PROVIDER_ELIGIBILITY,
        inject: [AI_PROVIDERS, AI_CIRCUIT_BREAKER, BYOK_PROVIDER_FACTORY],
        useFactory: (
          built: BuiltProviders,
          breaker: CircuitBreaker,
          byokFactory: ByokProviderFactory,
        ): ProviderEligibility =>
          new DefaultProviderEligibility({
            platformProviders: built.providers,
            breaker,
            byokFactory,
          }),
      },
      {
        provide: RUN_TASK,
        inject: [
          AI_PROVIDERS,
          AI_PROMPT_REGISTRY,
          AI_RESULT_CACHE,
          AI_USAGE_LEDGER,
          AI_QUOTA_POLICY,
          AI_CIRCUIT_BREAKER,
          AI_CLOCK,
          AI_LOGGER,
          BYOK_PROVIDER_FACTORY,
          AI_MODULE_OPTIONS,
          // Garantiza que la conexión de Redis (y sus hooks) se instancia junto a runTask.
          AI_CACHE_REDIS_CONNECTION,
        ],
        useFactory: (
          built: BuiltProviders,
          prompts: PromptRegistry,
          cache: ResultCache,
          ledger: MongoUsageLedger,
          quota: QuotaPolicy,
          breaker: CircuitBreaker,
          clock: Clock,
          logger: AiLogger,
          byokFactory: ByokProviderFactory,
          { config }: AiModuleOptions,
        ): RunTaskFn =>
          new RunTask({
            providers: built.providers,
            providerTimeoutsMs: providerTimeoutsMs(built, config),
            byokFactory,
            prompts,
            cache,
            ledger,
            quota,
            breaker,
            clock,
            logger,
          }).execute,
      },
      {
        provide: EMBED_TEXTS,
        inject: [
          AI_EMBED_PROVIDERS,
          AI_USAGE_LEDGER,
          AI_QUOTA_POLICY,
          AI_CIRCUIT_BREAKER,
          AI_CLOCK,
          AI_LOGGER,
        ],
        useFactory: (
          built: ReturnType<typeof buildEmbeddingProviders>,
          ledger: MongoUsageLedger,
          quota: QuotaPolicy,
          breaker: CircuitBreaker,
          clock: Clock,
          logger: AiLogger,
        ): EmbedTextsFn =>
          new EmbedTexts({
            providers: built.providers,
            providerTimeoutsMs: built.timeoutsMs,
            ledger,
            quota,
            breaker,
            clock,
            logger,
          }).execute,
      },
    ];

    return {
      module: AiModule,
      imports: options.imports ?? [],
      providers,
      exports: [
        RUN_TASK,
        EMBED_TEXTS,
        PROVIDER_ELIGIBILITY,
        SECRET_VAULT,
        USER_AI_KEYS_REPOSITORY,
        BYOK_VENDOR_AVAILABILITY,
      ],
    };
  }
}
