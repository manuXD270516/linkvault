import type { AiLogger } from '../../domain/ports/ai-logger.port';
import type { Clock } from '../../domain/ports/clock.port';
import type {
  QuotaDecision,
  QuotaPolicy,
} from '../../domain/ports/quota-policy.port';
import type { AiTaskName } from '../../domain/task';
import type { SuccessCounter } from '../persistence/mongo-usage-ledger';

// Cuotas diarias por usuario y tarea desde `AI_QUOTAS` (D9 de ai-gateway-core, ADR-018 §9 y §10). Cuenta los `success`
// de las últimas 24 h en el ledger con `maxTimeMS` y, además, compite contra un temporizador de aplicación: `maxTimeMS`
// no acota la selección de servidor del driver cuando Mongo cae tras conectar. Error o vencimiento → falla abierta.
// Cuando deniega, consulta el `success` más antiguo de la ventana para devolver `retryAt` (cv-match-suggestions 3.4).

export const QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_QUOTA_COUNT_TIMEOUT_MS = 300;

/** Límites diarios ya validados por la configuración; una tarea ausente no tiene límite. */
export type QuotaLimits = Readonly<Partial<Record<AiTaskName, number>>>;

export interface ConfigQuotaPolicyOptions {
  limits: QuotaLimits;
  counter: SuccessCounter;
  clock: Clock;
  logger: AiLogger;
  /** `maxTimeMS` y temporizador de aplicación. Por defecto 300 ms. */
  countTimeoutMs?: number;
}

const TIMED_OUT = Symbol('quota-count-timed-out');

export class ConfigQuotaPolicy implements QuotaPolicy {
  private readonly timeoutMs: number;

  constructor(private readonly options: ConfigQuotaPolicyOptions) {
    this.timeoutMs = options.countTimeoutMs ?? DEFAULT_QUOTA_COUNT_TIMEOUT_MS;
  }

  async allows(userId: string, task: AiTaskName): Promise<QuotaDecision> {
    const limit = this.options.limits[task];
    if (limit === undefined) return { allowed: true };

    const since = new Date(this.options.clock.now() - QUOTA_WINDOW_MS);
    const count = await this.withTimeout(
      () =>
        this.options.counter.countSuccessesSince({
          userId,
          task,
          since,
          maxTimeMS: this.timeoutMs,
        }),
      task,
      'AI quota count timed out, allowing execution',
      'AI quota count failed, allowing execution',
    );
    if (count === null || count < limit) return { allowed: true };

    const oldest = await this.withTimeout(
      () =>
        this.options.counter.oldestSuccessSince({
          userId,
          task,
          since,
          maxTimeMS: this.timeoutMs,
        }),
      task,
      'AI quota oldest-success timed out, allowing execution',
      'AI quota oldest-success failed, allowing execution',
    );
    // Sin el instante no se puede devolver un `retryAt` honesto: falla abierta (mismo contrato que el conteo).
    if (oldest === null) return { allowed: true };

    return {
      allowed: false,
      retryAt: new Date(oldest.getTime() + QUOTA_WINDOW_MS),
    };
  }

  /**
   * Corre una consulta del contador contra el temporizador de aplicación. `null` = timeout o error (falla abierta).
   */
  private async withTimeout<T>(
    run: () => Promise<T>,
    task: AiTaskName,
    timeoutMessage: string,
    failureMessage: string,
  ): Promise<T | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), this.timeoutMs);
      timer.unref();
    });

    try {
      const result = await Promise.race([run(), timeout]);
      if (result === TIMED_OUT) {
        this.options.logger.warn(timeoutMessage, {
          task,
          timeoutMs: this.timeoutMs,
        });
        return null;
      }
      return result;
    } catch (error) {
      this.options.logger.warn(failureMessage, {
        task,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
