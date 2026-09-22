import type {
  AiDegraded,
  AiResult,
  AiSuccess,
  DegradedReason,
} from '../domain/ai-result';
import {
  AiProgrammingError,
  FixtureMissing,
  InvalidDegradeOutput,
  InvalidPrompt,
  ProviderUnavailable,
} from '../domain/errors';
import type { AiLogger } from '../domain/ports/ai-logger.port';
import type { CircuitBreaker } from '../domain/ports/circuit-breaker.port';
import type { Clock } from '../domain/ports/clock.port';
import type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
} from '../domain/ports/llm-provider.port';
import type { PromptRegistry } from '../domain/ports/prompt-registry.port';
import type { QuotaPolicy } from '../domain/ports/quota-policy.port';
import type {
  CachedResult,
  ResultCache,
} from '../domain/ports/result-cache.port';
import type {
  UsageLedger,
  UsageOutcome,
  UsageRecord,
} from '../domain/ports/usage-ledger.port';
import { MOCK_PROVIDER_ID } from '../domain/provider-ids';
import { buildChain } from '../domain/routing-policy';
import {
  outputLanguageOf,
  type OutputLanguage,
  type RunContext,
} from '../domain/run-context';
import { dataSensitivityOf, type AiTask } from '../domain/task';
import type { ByokProvidersSource } from '../infrastructure/providers/byok-provider.factory';
import { isByokProviderId } from '../infrastructure/providers/byok-provider.factory';
import { executionKey } from './execution-key';
import {
  pendingFixtureLogFrom,
  type PendingFixtureLog,
} from './pending-fixtures';
import { PiiRedactor } from './pii-redactor';
import { cacheForChain } from './null-result-cache';
import {
  runStructuredOutput,
  StructuredOutputProviderError,
  type CompletionUsage,
} from './structured-output.pipeline';

// Punto de entrada único del módulo de IA (design-v0.2 §4.3, ADR-014, ADR-018; D2, D3, D4 y D9 de ai-gateway-core).

export interface RunTaskDeps {
  /** Proveedores de plataforma (`AI_CHAIN`), en ese orden. */
  providers: readonly LlmProvider[];
  /**
   * Factory de proveedores BYOK del usuario del contexto. Sin declarar, no se inyectan BYOK
   * (tests que solo ejercitan la cadena de plataforma).
   */
  byokFactory?: ByokProvidersSource;
  prompts: PromptRegistry;
  cache: ResultCache;
  ledger: UsageLedger;
  quota: QuotaPolicy;
  breaker: CircuitBreaker;
  clock: Clock;
  logger: AiLogger;
  /**
   * Plazo por petición de cada proveedor en ms (`OLLAMA_TIMEOUT_MS`, `OPENROUTER_TIMEOUT_MS`); los ausentes usan
   * `DEFAULT_PROVIDER_TIMEOUT_MS`. También admite ids `byok:*` si el llamador los registra.
   */
  providerTimeoutsMs?: Readonly<Record<string, number>>;
  /**
   * Registro de entradas pendientes de fixture. Sin declarar, se decide por entorno en cada anotación
   * (`pendingFixtureLogFrom`), que es lo que permite a un test apagarlo con `AI_PENDING_FIXTURES=off`. `null` lo apaga.
   */
  pendingFixtures?: PendingFixtureLog | null;
}

/** Firma del punto de entrada: `runTask(task, input, ctx)`. */
export type RunTaskFn = <I, O>(
  task: AiTask<I, O>,
  input: I,
  ctx: RunContext,
) => Promise<AiResult<O>>;

/** Identidad de una ejecución compartida por todos sus registros. */
interface Execution {
  task: AiTask<unknown, unknown>;
  ctx: RunContext;
  key: string;
}

type AttemptOutcome<O> =
  | {
      kind: 'success';
      output: O;
      /** Presente solo con `deferPiiReinjection` y redacción: copia lista para el usuario. */
      reinjectedOutput?: O;
      model: string;
    }
  | { kind: 'schema_error' }
  | { kind: 'provider_error' }
  | { kind: 'skipped' }
  | { kind: 'cancelled' };

/** Plazo por petición a un proveedor sin plazo configurado (D10). */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

const NO_USAGE: CompletionUsage = { inputTokens: 0, outputTokens: 0 };

export class RunTask {
  private readonly redactor = new PiiRedactor();

  /** Caché efectiva: nula si AI_CHAIN incluye el mock (D8). */
  private readonly cache: ResultCache;

  constructor(private readonly deps: RunTaskDeps) {
    this.cache = cacheForChain(deps.providers, deps.cache);
  }

  /**
   * Ejecuta una tarea. Devuelve `success` o `degraded`; solo lanza por input inválido (`ZodError`) y por errores de
   * programación (`AiProgrammingError`: `FixtureMissing`, `MockMisuse`, `InvalidFixture`, `SynthUnsupported`,
   * `InvalidPrompt`, `InvalidDegradeOutput`).
   */
  readonly execute: RunTaskFn = async <I, O>(
    task: AiTask<I, O>,
    input: I,
    ctx: RunContext,
  ): Promise<AiResult<O>> => {
    const parsedInput = task.inputSchema.parse(input);
    const outputLanguage = outputLanguageOf(ctx);
    const key = executionKey({
      taskName: task.name,
      promptVersion: task.promptVersion,
      outputLanguage,
      input: parsedInput,
    });
    const execution: Execution = { task, ctx, key };

    const cached = await this.readCache(task, key);
    if (cached !== null) return cached;

    const byokProviders = await this.resolveByokProviders(ctx.userId);
    const openIds = await this.deps.breaker.openIds();

    // Cuota de plataforma (success no-byok). Si está agotada y hay BYOK elegible → cadena solo BYOK (D7).
    // Si está agotada sin BYOK elegible → `quota_exceeded` antes de contactar a nadie.
    let restrictToByok = false;
    if (ctx.userId !== undefined) {
      const quota = await this.quotaDecision(ctx.userId, task);
      if (!quota.allowed) {
        const byokOnly = buildChain({
          task,
          ctx,
          providers: byokProviders,
          openIds,
        });
        if (byokOnly.providers.length === 0) {
          return this.degrade(
            task,
            parsedInput,
            'quota_exceeded',
            execution,
            quota.retryAt,
          );
        }
        restrictToByok = true;
      }
    }

    const universe = restrictToByok
      ? byokProviders
      : [...byokProviders, ...this.deps.providers];

    const { providers: chain, consentWouldEnable } = buildChain({
      task,
      ctx,
      providers: universe,
      openIds,
    });
    if (chain.length === 0) {
      // Con cadena vacía: consentimiento solo si la política dice que el permiso habría cambiado algo.
      // `runTask` NO recalcula `consentWouldEnable` por su cuenta.
      return this.degrade(
        task,
        parsedInput,
        consentWouldEnable ? 'consent_required' : 'no_providers',
        execution,
      );
    }

    let attempted = 0;
    for (const provider of chain) {
      // Cancelación del llamador (D10): se interrumpe la cadena con un único `degraded` `providers_failed`.
      if (ctx.signal?.aborted) {
        return this.degrade(task, parsedInput, 'providers_failed', execution);
      }
      const outcome = await this.attempt(
        provider,
        task,
        parsedInput,
        outputLanguage,
        execution,
      );
      if (outcome.kind === 'cancelled') {
        return this.degrade(task, parsedInput, 'providers_failed', execution);
      }
      if (outcome.kind !== 'skipped') attempted++;
      if (outcome.kind === 'success') {
        // Solo se guardan éxitos (ADR-018 §6): nunca `degraded`. Y solo si la tarea es cacheable.
        // La caché guarda siempre la copia lista para el usuario (reinyectada si aplica).
        await this.writeCache(execution, {
          output: outcome.reinjectedOutput ?? outcome.output,
          providerId: provider.id,
          model: outcome.model,
          promptVersion: task.promptVersion,
        });
        return {
          status: 'success',
          output: outcome.output,
          ...(outcome.reinjectedOutput !== undefined
            ? { reinjectedOutput: outcome.reinjectedOutput }
            : {}),
          providerId: provider.id,
          model: outcome.model,
          promptVersion: task.promptVersion,
          cached: false,
        };
      }
    }
    // Si ningún proveedor llegó a contactarse (todos sin permiso del breaker), no hubo proveedores disponibles.
    // `providers_failed` solo cuando hubo al menos un intento, aunque conceder el permiso hubiera añadido a otro.
    return this.degrade(
      task,
      parsedInput,
      attempted === 0 ? 'no_providers' : 'providers_failed',
      execution,
    );
  };

  /**
   * Lectura de caché antes de la cadena. Una tarea no cacheable nunca lee. Un fallo del almacén, una entrada de otra
   * versión de prompt o una salida que ya no cumple el schema cuentan como ausencia.
   */
  private async readCache<I, O>(
    task: AiTask<I, O>,
    key: string,
  ): Promise<AiSuccess<O> | null> {
    if (!task.cacheable) return null;

    let entry: CachedResult | null;
    try {
      entry = await this.cache.get(key);
    } catch (error) {
      this.deps.logger.warn('AI result cache read failed', {
        task: task.name,
        error: error instanceof Error ? error.name : 'unknown',
      });
      return null;
    }
    if (entry === null || entry.promptVersion !== task.promptVersion) {
      return null;
    }
    const parsed = task.outputSchema.safeParse(entry.output);
    if (!parsed.success) {
      this.deps.logger.debug('AI result cache entry ignored: invalid output', {
        task: task.name,
      });
      return null;
    }
    return {
      status: 'success',
      output: parsed.data,
      providerId: entry.providerId,
      model: entry.model,
      promptVersion: entry.promptVersion,
      cached: true,
    };
  }

  /** Falla abierta: si la política no puede decidir, se permite la ejecución (ADR-018 §9). */
  private async quotaDecision(
    userId: string,
    task: AiTask<unknown, unknown>,
  ): Promise<
    { allowed: true } | { allowed: false; retryAt: Date }
  > {
    try {
      return await this.deps.quota.allows(userId, task.name);
    } catch (error) {
      this.deps.logger.warn('AI quota check failed, allowing execution', {
        task: task.name,
        error: error instanceof Error ? error.name : 'unknown',
      });
      return { allowed: true };
    }
  }

  private async resolveByokProviders(
    userId: string | undefined,
  ): Promise<readonly LlmProvider[]> {
    if (this.deps.byokFactory === undefined || userId === undefined) {
      return [];
    }
    try {
      return await this.deps.byokFactory.providersFor(userId);
    } catch (error) {
      this.deps.logger.warn('BYOK provider resolution failed', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return [];
    }
  }

  private async writeCache(
    execution: Execution,
    entry: CachedResult,
  ): Promise<void> {
    if (!execution.task.cacheable) return;

    try {
      await this.cache.set(execution.key, entry);
    } catch (error) {
      this.deps.logger.warn('AI result cache write failed', {
        task: execution.task.name,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  /** Un intento completo con un proveedor (petición original y, si procede, una reparación): un registro de ledger. */
  private async attempt<I, O>(
    provider: LlmProvider,
    task: AiTask<I, O>,
    parsedInput: I,
    outputLanguage: OutputLanguage,
    execution: Execution,
  ): Promise<AttemptOutcome<O>> {
    // Redacción solo para tareas `personal` hacia proveedores externos (D11, ADR-018 §11). La clave ya se calculó
    // sobre el input sin redactar; el mapa de marcadores vive solo en `redaction` durante este intento.
    const redaction =
      dataSensitivityOf(task) === 'personal' && provider.capabilities.external
        ? this.redactor.redact(parsedInput, {
            redactName: execution.ctx.redactName,
            personName: execution.ctx.personName,
          })
        : undefined;
    // `acquired`: el breaker concedió permiso (quizá el único de half-open). Solo entonces hay algo que devolver con
    // `release` si la ejecución termina por un error de programación o una cancelación (D2, D10).
    let acquired = false;
    let startedAt = 0;
    const latency = () => this.deps.clock.now() - startedAt;

    try {
      const prompt = await this.deps.prompts.render(
        { taskName: task.name, promptVersion: task.promptVersion },
        { input: redaction?.value ?? parsedInput, outputLanguage },
      );
      const request: CompletionRequest = {
        system: prompt.system,
        user: prompt.user,
        temperature: task.temperature,
        maxTokens: task.budget.maxTokens,
        responseFormat: provider.capabilities.jsonMode ? 'json' : 'text',
        trace: {
          taskName: task.name,
          promptVersion: task.promptVersion,
          key: execution.key,
          // Input parseado sin redactar: solo para el mock (synth), nunca en peticiones a proveedores reales (D4).
          ...(provider.id === MOCK_PROVIDER_ID ? { input: parsedInput } : {}),
        },
      };
      // Justo antes de completar (D10): en half-open concede un único permiso; si no hay permiso, se salta sin registro.
      if (!(await this.deps.breaker.tryAcquire(provider.id))) {
        this.deps.logger.debug('AI provider skipped: circuit open', {
          task: task.name,
          providerId: provider.id,
        });
        return { kind: 'skipped' };
      }
      acquired = true;
      startedAt = this.deps.clock.now();

      const result = await runStructuredOutput({
        complete: (req) =>
          this.completeWithDeadline(provider, req, execution.ctx.signal),
        request,
        outputSchema: task.outputSchema,
        maxAttempts: task.budget.maxAttempts,
        // D10: un marcador inventado invalida la salida (reparación → siguiente proveedor → degradación).
        emittedMarkers: redaction?.emittedMarkers,
      });
      const base = {
        provider,
        model: result.model,
        usage: result.usage,
        latencyMs: latency(),
      };
      // Cualquier respuesta, válida o no según el schema, cuenta como disponibilidad (ADR-018 §7).
      await this.deps.breaker.recordSuccess(provider.id);
      if (result.status === 'valid') {
        this.record(execution, 'success', base);
        if (redaction === undefined) {
          return { kind: 'success', output: result.output, model: result.model };
        }
        const reinjected = redaction.reinject(result.output);
        // ADR-031: el juez necesita marcadores; la reinyección es para persistir/GET (D10).
        if (execution.ctx.deferPiiReinjection === true) {
          return {
            kind: 'success',
            output: result.output,
            reinjectedOutput: reinjected,
            model: result.model,
          };
        }
        return { kind: 'success', output: reinjected, model: result.model };
      }
      this.record(execution, 'schema_error', base);
      return { kind: 'schema_error' };
    } catch (error) {
      const cause =
        error instanceof StructuredOutputProviderError ? error.cause : error;
      // Errores de programación (`AiProgrammingError`: InvalidPrompt al renderizar, FixtureMissing, MockMisuse,
      // InvalidFixture, SynthUnsupported): no son fallos del proveedor y deben hacer fallar el test o el arranque que los
      // provoca (D2, D4). Antes se devuelve el permiso de half-open si se había tomado (D10).
      if (cause instanceof AiProgrammingError) {
        if (acquired) await this.deps.breaker.release(provider.id);
        // Un fixture que falta se anota antes de propagar el error: el test falla igual, pero deja dicho qué grabar.
        if (cause instanceof FixtureMissing) {
          this.recordPendingFixture(
            task,
            parsedInput,
            outputLanguage,
            execution,
          );
        }
        throw cause;
      }
      // Sin permiso tomado, el fallo ocurrió al renderizar el prompt: no es un `provider_error` (ni breaker ni ledger) y
      // se propaga como `InvalidPrompt` (D2). El detalle solo lleva el `name` del error: su mensaje podría contener el
      // input o el prompt.
      if (!acquired) {
        throw new InvalidPrompt(
          task.name,
          task.promptVersion,
          `render failed (${error instanceof Error ? error.name : 'unknown error'})`,
        );
      }
      // Cancelación del llamador: ni `provider_error` ni fallo en el breaker; se devuelve el permiso de half-open.
      if (execution.ctx.signal?.aborted) {
        await this.deps.breaker.release(provider.id);
        return { kind: 'cancelled' };
      }
      await this.deps.breaker.recordFailure(provider.id);
      this.record(execution, 'provider_error', {
        provider,
        model: null,
        usage:
          error instanceof StructuredOutputProviderError
            ? error.usage
            : NO_USAGE,
        latencyMs: latency(),
      });
      this.deps.logger.warn('AI provider error', {
        task: task.name,
        providerId: provider.id,
        httpStatus:
          cause instanceof ProviderUnavailable ? cause.httpStatus : undefined,
        error: cause instanceof Error ? cause.name : 'unknown',
      });
      return { kind: 'provider_error' };
    }
  }

  /**
   * Una petición al proveedor con plazo (D10): la señal combina el timeout del proveedor y `ctx.signal` (filtrando
   * ausentes), viaja en `req.signal` y además compite contra `complete()`, así que la petición termina al abortarse
   * aunque el proveedor ignore la señal. Al abortar rechaza con el motivo de la señal.
   */
  private completeWithDeadline(
    provider: LlmProvider,
    request: CompletionRequest,
    callerSignal: AbortSignal | undefined,
  ): Promise<CompletionResult> {
    const signal = AbortSignal.any(
      [AbortSignal.timeout(this.timeoutFor(provider.id)), callerSignal].filter(
        (candidate): candidate is AbortSignal => candidate !== undefined,
      ),
    );
    if (signal.aborted) return Promise.reject(abortReason(signal));

    return new Promise<CompletionResult>((resolve, reject) => {
      const onAbort = () => reject(abortReason(signal));
      signal.addEventListener('abort', onAbort, { once: true });
      let completion: Promise<CompletionResult>;
      try {
        completion = provider.complete({ ...request, signal });
      } catch (error) {
        completion = Promise.reject(error);
      }
      completion
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  private timeoutFor(providerId: string): number {
    const configured = this.deps.providerTimeoutsMs?.[providerId];
    if (configured !== undefined) return configured;
    if (isByokProviderId(providerId)) {
      const vendor = providerId.split(':')[2];
      if (vendor !== undefined) {
        const byVendor = this.deps.providerTimeoutsMs?.[vendor];
        if (byVendor !== undefined) return byVendor;
      }
    }
    return DEFAULT_PROVIDER_TIMEOUT_MS;
  }

  /**
   * Anota la entrada que no tiene fixture (spec "Registro de entradas pendientes de fixture"). La entrada de una tarea
   * `personal` no se anota: el registro queda en disco y CLAUDE.md prohíbe guardar ahí texto de CV.
   */
  private recordPendingFixture<I, O>(
    task: AiTask<I, O>,
    parsedInput: I,
    outputLanguage: OutputLanguage,
    execution: Execution,
  ): void {
    const log =
      this.deps.pendingFixtures === undefined
        ? pendingFixtureLogFrom()
        : this.deps.pendingFixtures;
    if (log === null) return;

    const redacted = dataSensitivityOf(task) === 'personal';
    log.record({
      task: task.name,
      promptVersion: task.promptVersion,
      outputLanguage,
      key: execution.key,
      ...(redacted ? {} : { input: parsedInput }),
      redacted,
    });
  }

  /** Resultado degradado con su único registro y la salida validada de `task.degrade`, si existe. */
  private degrade<I, O>(
    task: AiTask<I, O>,
    parsedInput: I,
    reason: DegradedReason,
    execution: Execution,
    retryAt?: Date,
  ): AiDegraded<O> {
    this.record(execution, reason === 'quota_exceeded' ? 'quota' : 'degraded', {
      provider: null,
      model: null,
      usage: NO_USAGE,
      latencyMs: 0,
      reason: reason === 'quota_exceeded' ? undefined : reason,
    });
    const retryField =
      reason === 'quota_exceeded' && retryAt !== undefined
        ? { aiQuotaRetryAt: retryAt.toISOString() }
        : {};

    if (task.degrade === undefined) {
      return { status: 'degraded', reason, ...retryField };
    }

    const parsed = task.outputSchema.safeParse(task.degrade(parsedInput));
    if (!parsed.success) {
      throw new InvalidDegradeOutput(
        task.name,
        parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        ),
      );
    }
    return {
      status: 'degraded',
      reason,
      output: parsed.data,
      ...retryField,
    };
  }

  private record(
    execution: Execution,
    outcome: UsageOutcome,
    attempt: {
      provider: LlmProvider | null;
      model: string | null;
      usage: CompletionUsage;
      latencyMs: number;
      reason?: DegradedReason;
    },
  ): void {
    const { provider, usage } = attempt;
    const entry: UsageRecord = {
      ...(execution.ctx.userId === undefined
        ? {}
        : { userId: execution.ctx.userId }),
      task: execution.task.name,
      providerId: provider?.id ?? null,
      model: attempt.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estCost:
        provider === null
          ? 0
          : (usage.inputTokens / 1000) * provider.capabilities.costPer1kIn +
            (usage.outputTokens / 1000) * provider.capabilities.costPer1kOut,
      latencyMs: attempt.latencyMs,
      outcome,
      ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
      promptVersion: execution.task.promptVersion,
      key: execution.key,
      at: new Date(this.deps.clock.now()),
    };
    // No bloqueante (ADR-018 §10): runTask nunca espera la confirmación del ledger.
    try {
      void this.deps.ledger.record(entry).catch((error: unknown) => {
        this.warnLedgerFailure(execution, error);
      });
    } catch (error) {
      this.warnLedgerFailure(execution, error);
    }
  }

  private warnLedgerFailure(execution: Execution, error: unknown): void {
    this.deps.logger.warn('AI usage ledger write failed', {
      task: execution.task.name,
      error: error instanceof Error ? error.name : 'unknown',
    });
  }
}

/** Motivo del aborto como `Error` (el de `AbortSignal.timeout` es un `DOMException` `TimeoutError`). */
function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new DOMException('The operation was aborted', 'AbortError');
}
