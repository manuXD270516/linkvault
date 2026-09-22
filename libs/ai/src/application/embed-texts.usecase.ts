import type { DegradedReason } from '../domain/ai-result';
import { ProviderUnavailable } from '../domain/errors';
import { buildEmbedChain } from '../domain/embedding-routing';
import type { AiLogger } from '../domain/ports/ai-logger.port';
import type { CircuitBreaker } from '../domain/ports/circuit-breaker.port';
import type { Clock } from '../domain/ports/clock.port';
import {
  EMBED_OPERATION,
  type EmbeddingProvider,
  type EmbedResult,
} from '../domain/ports/embedding-provider.port';
import type { QuotaPolicy } from '../domain/ports/quota-policy.port';
import type {
  UsageLedger,
  UsageOutcome,
  UsageRecord,
} from '../domain/ports/usage-ledger.port';
import type { RunContext } from '../domain/run-context';
import { PiiRedactor } from './pii-redactor';
import { embedExecutionKey } from './embed-execution-key';

// Única puerta de aplicación para embeddings (ADR-036 / C4). No pasa por runTask.

/** Versión fija de la operación embed (no hay prompt Mustache). */
export const EMBED_PROMPT_VERSION = 'v1';

export const DEFAULT_EMBED_PROVIDER_TIMEOUT_MS = 30_000;

export interface EmbedTextsSuccess {
  status: 'success';
  vectors: number[][];
  providerId: string;
  model: string;
  dimensions: number;
}

export interface EmbedTextsDegraded {
  status: 'degraded';
  reason: DegradedReason;
  aiQuotaRetryAt?: string;
}

export type EmbedTextsResult = EmbedTextsSuccess | EmbedTextsDegraded;

export type EmbedTextsFn = (
  texts: readonly string[],
  ctx: RunContext,
) => Promise<EmbedTextsResult>;

export interface EmbedTextsDeps {
  providers: readonly EmbeddingProvider[];
  ledger: UsageLedger;
  quota: QuotaPolicy;
  breaker: CircuitBreaker;
  clock: Clock;
  logger: AiLogger;
  /** Plazo por proveedor en ms; ausentes usan DEFAULT_EMBED_PROVIDER_TIMEOUT_MS. */
  providerTimeoutsMs?: Readonly<Record<string, number>>;
}

const NO_USAGE = { inputTokens: 0 };

export class EmbedTexts {
  private readonly redactor = new PiiRedactor();

  constructor(private readonly deps: EmbedTextsDeps) {}

  /**
   * Genera embeddings. Sensibilidad siempre `personal` (C11). Consentimiento = dueño
   * (`ctx.userId` + `ctx.aiConsent`). Devuelve `success` o `degraded`; no lanza por fallo de proveedor.
   */
  readonly execute: EmbedTextsFn = async (texts, ctx) => {
    const canonical = [...texts];
    const key = embedExecutionKey(canonical);

    if (ctx.userId !== undefined) {
      const quota = await this.quotaDecision(ctx.userId);
      if (!quota.allowed) {
        this.record(ctx, key, 'quota', {
          provider: null,
          model: null,
          usage: NO_USAGE,
          latencyMs: 0,
        });
        return {
          status: 'degraded',
          reason: 'quota_exceeded',
          aiQuotaRetryAt: quota.retryAt.toISOString(),
        };
      }
    }

    const openIds = await this.deps.breaker.openIds();
    const { providers: chain, consentWouldEnable } = buildEmbedChain({
      aiConsent: ctx.aiConsent,
      providers: this.deps.providers,
      openIds,
    });

    if (chain.length === 0) {
      const reason: DegradedReason = consentWouldEnable
        ? 'consent_required'
        : 'no_providers';
      this.record(ctx, key, 'degraded', {
        provider: null,
        model: null,
        usage: NO_USAGE,
        latencyMs: 0,
        reason,
      });
      return { status: 'degraded', reason };
    }

    let attempted = 0;
    for (const provider of chain) {
      if (ctx.signal?.aborted) {
        this.record(ctx, key, 'degraded', {
          provider: null,
          model: null,
          usage: NO_USAGE,
          latencyMs: 0,
          reason: 'providers_failed',
        });
        return { status: 'degraded', reason: 'providers_failed' };
      }

      const outcome = await this.attempt(provider, canonical, key, ctx);
      if (outcome.kind === 'cancelled') {
        this.record(ctx, key, 'degraded', {
          provider: null,
          model: null,
          usage: NO_USAGE,
          latencyMs: 0,
          reason: 'providers_failed',
        });
        return { status: 'degraded', reason: 'providers_failed' };
      }
      if (outcome.kind !== 'skipped') attempted++;
      if (outcome.kind === 'success') {
        return {
          status: 'success',
          vectors: outcome.result.vectors,
          providerId: provider.id,
          model: outcome.result.model,
          dimensions: outcome.result.dimensions,
        };
      }
    }

    const reason: DegradedReason =
      attempted === 0 ? 'no_providers' : 'providers_failed';
    this.record(ctx, key, 'degraded', {
      provider: null,
      model: null,
      usage: NO_USAGE,
      latencyMs: 0,
      reason,
    });
    return { status: 'degraded', reason };
  };

  private async attempt(
    provider: EmbeddingProvider,
    canonical: string[],
    key: string,
    ctx: RunContext,
  ): Promise<
    | { kind: 'success'; result: EmbedResult }
    | { kind: 'provider_error' }
    | { kind: 'skipped' }
    | { kind: 'cancelled' }
  > {
    const outbound =
      provider.capabilities.external
        ? this.redactor.redact(canonical, {
            redactName: ctx.redactName,
            personName: ctx.personName,
          }).value
        : canonical;

    let acquired = false;
    let startedAt = 0;
    const latency = () => this.deps.clock.now() - startedAt;

    try {
      if (!(await this.deps.breaker.tryAcquire(provider.id))) {
        this.deps.logger.debug('AI embed provider skipped: circuit open', {
          task: EMBED_OPERATION,
          providerId: provider.id,
        });
        return { kind: 'skipped' };
      }
      acquired = true;
      startedAt = this.deps.clock.now();

      const result = await this.embedWithDeadline(provider, {
        texts: outbound,
        signal: undefined,
        trace: {
          operation: EMBED_OPERATION,
          key,
          ...(provider.id === 'mock' ? { texts: canonical } : {}),
        },
      }, ctx.signal);

      await this.deps.breaker.recordSuccess(provider.id);
      this.record(ctx, key, 'success', {
        provider,
        model: result.model,
        usage: result.usage,
        latencyMs: latency(),
      });
      return { kind: 'success', result };
    } catch (error) {
      if (ctx.signal?.aborted) {
        if (acquired) await this.deps.breaker.release(provider.id);
        return { kind: 'cancelled' };
      }
      if (acquired) {
        await this.deps.breaker.recordFailure(provider.id);
        this.record(ctx, key, 'provider_error', {
          provider,
          model: null,
          usage: NO_USAGE,
          latencyMs: latency(),
        });
        this.deps.logger.warn('AI embed provider error', {
          task: EMBED_OPERATION,
          providerId: provider.id,
          httpStatus:
            error instanceof ProviderUnavailable ? error.httpStatus : undefined,
          error: error instanceof Error ? error.name : 'unknown',
        });
      }
      return { kind: 'provider_error' };
    }
  }

  private embedWithDeadline(
    provider: EmbeddingProvider,
    request: Parameters<EmbeddingProvider['embed']>[0],
    callerSignal: AbortSignal | undefined,
  ): Promise<EmbedResult> {
    const signal = AbortSignal.any(
      [
        AbortSignal.timeout(this.timeoutFor(provider.id)),
        callerSignal,
      ].filter((c): c is AbortSignal => c !== undefined),
    );
    if (signal.aborted) {
      return Promise.reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error('aborted'),
      );
    }
    return provider.embed({ ...request, signal });
  }

  private timeoutFor(providerId: string): number {
    return (
      this.deps.providerTimeoutsMs?.[providerId] ??
      DEFAULT_EMBED_PROVIDER_TIMEOUT_MS
    );
  }

  private async quotaDecision(
    userId: string,
  ): Promise<{ allowed: true } | { allowed: false; retryAt: Date }> {
    try {
      return await this.deps.quota.allows(userId, EMBED_OPERATION);
    } catch (error) {
      this.deps.logger.warn('AI embed quota check failed, allowing', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return { allowed: true };
    }
  }

  private record(
    ctx: RunContext,
    key: string,
    outcome: UsageOutcome,
    attempt: {
      provider: EmbeddingProvider | null;
      model: string | null;
      usage: { inputTokens: number };
      latencyMs: number;
      reason?: DegradedReason;
    },
  ): void {
    const { provider, usage } = attempt;
    const entry: UsageRecord = {
      ...(ctx.userId === undefined ? {} : { userId: ctx.userId }),
      task: EMBED_OPERATION,
      providerId: provider?.id ?? null,
      model: attempt.model,
      inputTokens: usage.inputTokens,
      outputTokens: 0,
      estCost:
        provider === null
          ? 0
          : (usage.inputTokens / 1000) * provider.capabilities.costPer1kTokens,
      latencyMs: attempt.latencyMs,
      outcome,
      ...(attempt.reason === undefined ? {} : { reason: attempt.reason }),
      promptVersion: EMBED_PROMPT_VERSION,
      key,
      at: new Date(this.deps.clock.now()),
    };
    try {
      void this.deps.ledger.record(entry).catch((error: unknown) => {
        this.deps.logger.warn('AI usage ledger write failed', {
          task: EMBED_OPERATION,
          error: error instanceof Error ? error.name : 'unknown',
        });
      });
    } catch (error) {
      this.deps.logger.warn('AI usage ledger write failed', {
        task: EMBED_OPERATION,
        error: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}
