import type { AiLogFields, AiLogger } from '../../domain/ports/ai-logger.port';
import type { CircuitBreaker } from '../../domain/ports/circuit-breaker.port';
import type { Clock } from '../../domain/ports/clock.port';
import type {
  PromptRef,
  PromptRegistry,
  PromptView,
  RenderedPrompt,
} from '../../domain/ports/prompt-registry.port';
import type { QuotaPolicy } from '../../domain/ports/quota-policy.port';
import type {
  CachedResult,
  ResultCache,
} from '../../domain/ports/result-cache.port';
import type {
  UsageLedger,
  UsageRecord,
} from '../../domain/ports/usage-ledger.port';
import type { AiTaskName } from '../../domain/task';

// Implementaciones en memoria de los puertos de runTask para tests de application (sin Mongo, Redis ni archivos).
// No son adaptadores de producción: los reales viven en infrastructure (grupos 6–10).

export class InMemoryResultCache implements ResultCache {
  readonly entries = new Map<string, CachedResult>();
  gets = 0;
  sets = 0;
  /** Si es true, `get` y `set` rechazan como un Redis caído. */
  failing = false;

  get(key: string): Promise<CachedResult | null> {
    this.gets++;
    if (this.failing) return Promise.reject(new Error('cache unavailable'));
    return Promise.resolve(this.entries.get(key) ?? null);
  }

  set(key: string, value: CachedResult): Promise<void> {
    this.sets++;
    if (this.failing) return Promise.reject(new Error('cache unavailable'));
    this.entries.set(key, structuredClone(value));
    return Promise.resolve();
  }
}

export type LedgerMode = 'ok' | 'rejects' | 'never-resolves';

export class InMemoryUsageLedger implements UsageLedger {
  readonly records: UsageRecord[] = [];

  constructor(public mode: LedgerMode = 'ok') {}

  record(entry: UsageRecord): Promise<void> {
    this.records.push(entry);
    switch (this.mode) {
      case 'ok':
        return Promise.resolve();
      case 'rejects':
        return Promise.reject(new Error('ledger unavailable'));
      case 'never-resolves':
        return new Promise<void>(() => undefined);
    }
  }
}

/** Cuota por tarea sobre un contador de éxitos en memoria, o una función arbitraria. */
export class InMemoryQuotaPolicy implements QuotaPolicy {
  readonly calls: { userId: string; task: AiTaskName }[] = [];

  constructor(
    private readonly decide: (
      userId: string,
      task: AiTaskName,
    ) => Promise<boolean> = () => Promise.resolve(true),
  ) {}

  allows(userId: string, task: AiTaskName): Promise<boolean> {
    this.calls.push({ userId, task });
    return this.decide(userId, task);
  }
}

export interface LogEntry {
  level: 'debug' | 'warn';
  message: string;
  fields?: AiLogFields;
}

export class InMemoryAiLogger implements AiLogger {
  readonly entries: LogEntry[] = [];

  debug(message: string, fields?: AiLogFields): void {
    this.entries.push({ level: 'debug', message, fields });
  }

  warn(message: string, fields?: AiLogFields): void {
    this.entries.push({ level: 'warn', message, fields });
  }

  get warnings(): LogEntry[] {
    return this.entries.filter((entry) => entry.level === 'warn');
  }
}

/** Breaker que nunca abre; registra las llamadas para comprobar la integración. */
export class RecordingNullCircuitBreaker implements CircuitBreaker {
  readonly acquired: string[] = [];
  readonly successes: string[] = [];
  readonly failures: string[] = [];

  openIds(): ReadonlySet<string> {
    return new Set();
  }

  tryAcquire(providerId: string): boolean {
    this.acquired.push(providerId);
    return true;
  }

  recordSuccess(providerId: string): void {
    this.successes.push(providerId);
  }

  recordFailure(providerId: string): void {
    this.failures.push(providerId);
  }

  readonly released: string[] = [];

  release(providerId: string): void {
    this.released.push(providerId);
  }
}

/** Reloj manual: `advance` mueve el tiempo. */
export class ManualClock implements Clock {
  constructor(private current = Date.parse('2026-09-17T10:00:00.000Z')) {}

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

/**
 * Registro de prompts en memoria: `system` identifica tarea, versión e idioma; `user` es el JSON del input recibido,
 * lo que permite comprobar qué datos llegan al proveedor.
 */
export class InMemoryPromptRegistry implements PromptRegistry {
  readonly rendered: RenderedPrompt[] = [];

  ensure(): Promise<void> {
    return Promise.resolve();
  }

  render(ref: PromptRef, view: PromptView): Promise<RenderedPrompt> {
    const prompt = {
      system: `${ref.taskName}@${ref.promptVersion} lang=${view.outputLanguage}`,
      user: JSON.stringify(view.input),
    };
    this.rendered.push(prompt);
    return Promise.resolve(prompt);
  }
}
