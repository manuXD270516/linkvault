import type { AiLogFields, AiLogger } from '../../domain/ports/ai-logger.port';
import type { CircuitBreaker } from '../../domain/ports/circuit-breaker.port';
import type {
  QuotaDecision,
  QuotaPolicy,
} from '../../domain/ports/quota-policy.port';
import type {
  UsageLedger,
  UsageRecord,
} from '../../domain/ports/usage-ledger.port';

// Dobles propios del corredor de evaluación (D1 y D3 de ai-eval-harness, ADR-019 §6). No son dobles de test: el
// corredor los usa en ejecución real, sin Mongo, Redis ni `application/testing/**`.

/** Ledger en memoria: guarda los registros para sumar tokens y coste por clave de ejecución. */
export class EvalUsageLedger implements UsageLedger {
  private readonly records: UsageRecord[] = [];

  record(entry: UsageRecord): Promise<void> {
    this.records.push(entry);
    return Promise.resolve();
  }

  /** Registros de una clave, en orden de escritura, sin retirarlos. */
  recordsFor(key: string): readonly UsageRecord[] {
    return this.records.filter((entry) => entry.key === key);
  }

  /** Retira y devuelve los registros de una clave: una segunda ejecución de la misma clave no suma los anteriores. */
  take(key: string): UsageRecord[] {
    const taken: UsageRecord[] = [];
    for (let index = this.records.length - 1; index >= 0; index--) {
      const entry = this.records[index];
      if (entry?.key === key) {
        taken.unshift(entry);
        this.records.splice(index, 1);
      }
    }
    return taken;
  }
}

/** Cuota que siempre permite: la evaluación no tiene usuario ni límites. */
export class AllowAllQuotaPolicy implements QuotaPolicy {
  allows(): Promise<QuotaDecision> {
    return Promise.resolve({ allowed: true });
  }
}

/** Breaker que nunca abre: cada caso contacta al proveedor aunque los anteriores hayan fallado. */
export class NullCircuitBreaker implements CircuitBreaker {
  openIds(): ReadonlySet<string> {
    return new Set();
  }

  tryAcquire(): boolean {
    return true;
  }

  recordSuccess(): void {
    // Sin estado.
  }

  recordFailure(): void {
    // Sin estado.
  }

  release(): void {
    // Sin estado.
  }
}

export type TextWriter = (chunk: string) => void;

/** Escritura en `stderr` del proceso. */
export const writeToStderr: TextWriter = (chunk) => {
  process.stderr.write(chunk);
};

/**
 * Logger a `stderr`, una línea JSON por evento. Solo `warn` por defecto: `debug` se descarta salvo `verbose`. Recibe lo
 * mismo que cualquier `AiLogger`: identificadores y métricas, nunca inputs ni prompts.
 */
export class StderrAiLogger implements AiLogger {
  constructor(
    private readonly write: TextWriter = writeToStderr,
    private readonly verbose = false,
  ) {}

  debug(message: string, fields?: AiLogFields): void {
    if (this.verbose) this.emit('debug', message, fields);
  }

  warn(message: string, fields?: AiLogFields): void {
    this.emit('warn', message, fields);
  }

  private emit(
    level: 'debug' | 'warn',
    message: string,
    fields: AiLogFields | undefined,
  ): void {
    this.write(`${JSON.stringify({ level, message, ...fields })}\n`);
  }
}
