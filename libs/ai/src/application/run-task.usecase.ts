import type {
  AiDegraded,
  AiResult,
  AiSuccess,
  DegradedReason,
} from '../domain/ai-result';
import {
  FixtureMissing,
  InvalidDegradeOutput,
  ProviderUnavailable,
} from '../domain/errors';
import type { AiLogger } from '../domain/ports/ai-logger.port';
import type { CircuitBreaker } from '../domain/ports/circuit-breaker.port';
import type { Clock } from '../domain/ports/clock.port';
import type {
  CompletionRequest,
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
import { buildChain } from '../domain/routing-policy';
import {
  outputLanguageOf,
  type OutputLanguage,
  type RunContext,
} from '../domain/run-context';
import { dataSensitivityOf, type AiTask } from '../domain/task';
import { executionKey } from './execution-key';
import { PiiRedactor } from './pii-redactor';
import { cacheForChain } from './null-result-cache';
import {
  runStructuredOutput,
  StructuredOutputProviderError,
  type CompletionUsage,
} from './structured-output.pipeline';

// Punto de entrada único del módulo de IA (design-v0.2 §4.3, ADR-014, ADR-018; D2, D3, D4 y D9 de ai-gateway-core).

export interface RunTaskDeps {
  /** Proveedores configurados, en el orden de AI_CHAIN. */
  providers: readonly LlmProvider[];
  prompts: PromptRegistry;
  cache: ResultCache;
  ledger: UsageLedger;
  quota: QuotaPolicy;
  breaker: CircuitBreaker;
  clock: Clock;
  logger: AiLogger;
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
  | { kind: 'success'; output: O; model: string }
  | { kind: 'schema_error' }
  | { kind: 'provider_error' };

const NO_USAGE: CompletionUsage = { inputTokens: 0, outputTokens: 0 };

export class RunTask {
  private readonly redactor = new PiiRedactor();

  /** Caché efectiva: nula si AI_CHAIN incluye el mock (D8). */
  private readonly cache: ResultCache;

  constructor(private readonly deps: RunTaskDeps) {
    this.cache = cacheForChain(deps.providers, deps.cache);
  }

  /**
   * Ejecuta una tarea. Devuelve `success` o `degraded`; solo lanza por input inválido (`ZodError`), `FixtureMissing`
   * e `InvalidDegradeOutput`.
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

    // Cuota por usuario y tarea, una vez antes de la cadena (D9, ADR-018 §9). Sin usuario no hay cuota.
    if (
      ctx.userId !== undefined &&
      !(await this.quotaAllows(ctx.userId, task))
    ) {
      return this.degrade(task, parsedInput, 'quota_exceeded', execution);
    }

    const chain = buildChain({
      task,
      ctx,
      providers: this.deps.providers,
      openIds: this.deps.breaker.openIds(),
    });
    if (chain.length === 0) {
      return this.degrade(task, parsedInput, 'no_providers', execution);
    }

    for (const provider of chain) {
      const outcome = await this.attempt(
        provider,
        task,
        parsedInput,
        outputLanguage,
        execution,
      );
      if (outcome.kind === 'success') {
        // Solo se guardan éxitos (ADR-018 §6): nunca `degraded`.
        await this.writeCache(execution, {
          output: outcome.output,
          providerId: provider.id,
          model: outcome.model,
          promptVersion: task.promptVersion,
        });
        return {
          status: 'success',
          output: outcome.output,
          providerId: provider.id,
          model: outcome.model,
          promptVersion: task.promptVersion,
          cached: false,
        };
      }
    }
    return this.degrade(task, parsedInput, 'providers_failed', execution);
  };

  /**
   * Lectura de caché antes de la cadena. Un fallo del almacén, una entrada de otra versión de prompt o una salida que
   * ya no cumple el schema cuentan como ausencia.
   */
  private async readCache<I, O>(
    task: AiTask<I, O>,
    key: string,
  ): Promise<AiSuccess<O> | null> {
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
  private async quotaAllows(
    userId: string,
    task: AiTask<unknown, unknown>,
  ): Promise<boolean> {
    try {
      return await this.deps.quota.allows(userId, task.name);
    } catch (error) {
      this.deps.logger.warn('AI quota check failed, allowing execution', {
        task: task.name,
        error: error instanceof Error ? error.name : 'unknown',
      });
      return true;
    }
  }

  private async writeCache(
    execution: Execution,
    entry: CachedResult,
  ): Promise<void> {
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
      signal: execution.ctx.signal,
      trace: {
        taskName: task.name,
        promptVersion: task.promptVersion,
        key: execution.key,
      },
    };
    const startedAt = this.deps.clock.now();
    const latency = () => this.deps.clock.now() - startedAt;

    try {
      const result = await runStructuredOutput({
        complete: (req) => provider.complete(req),
        request,
        outputSchema: task.outputSchema,
        maxAttempts: task.budget.maxAttempts,
      });
      const base = {
        provider,
        model: result.model,
        usage: result.usage,
        latencyMs: latency(),
      };
      if (result.status === 'valid') {
        this.record(execution, 'success', base);
        const output = redaction
          ? redaction.reinject(result.output)
          : result.output;
        return { kind: 'success', output, model: result.model };
      }
      this.record(execution, 'schema_error', base);
      return { kind: 'schema_error' };
    } catch (error) {
      const cause =
        error instanceof StructuredOutputProviderError ? error.cause : error;
      // El fixture ausente del mock en replay no es un fallo de proveedor: debe hacer fallar el test (D2).
      if (cause instanceof FixtureMissing) throw cause;
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

  /** Resultado degradado con su único registro y la salida validada de `task.degrade`, si existe. */
  private degrade<I, O>(
    task: AiTask<I, O>,
    parsedInput: I,
    reason: DegradedReason,
    execution: Execution,
  ): AiDegraded<O> {
    this.record(execution, reason === 'quota_exceeded' ? 'quota' : 'degraded', {
      provider: null,
      model: null,
      usage: NO_USAGE,
      latencyMs: 0,
      reason: reason === 'quota_exceeded' ? undefined : reason,
    });
    if (task.degrade === undefined) return { status: 'degraded', reason };

    const parsed = task.outputSchema.safeParse(task.degrade(parsedInput));
    if (!parsed.success) {
      throw new InvalidDegradeOutput(
        task.name,
        parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
        ),
      );
    }
    return { status: 'degraded', reason, output: parsed.data };
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
