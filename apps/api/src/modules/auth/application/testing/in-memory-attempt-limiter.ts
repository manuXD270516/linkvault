import { ATTEMPT_WINDOW_MS } from '../../domain/attempt-limits';
import { ipLimitGroup } from '../../../../infrastructure/limits/client-ip';
import type { Clock } from '../../domain/clock';
import type {
  AttemptDecision,
  AttemptKey,
  AttemptLimiter,
} from '../ports/attempt-limiter.port';

// Limitador en memoria para tests de application (D7 y D12 de auth-users), con las mismas reglas que
// `RedisAttemptLimiter`: ventana fija, conteo antes de verificar, IPv6 por /64 y éxito que reinicia el email y descuenta
// la IP. No es un adaptador de producción.

interface Counter {
  count: number;
  expiresAt: number;
}

function counterName(key: AttemptKey): string {
  switch (key.kind) {
    case 'login-email':
      return `login-email:${key.email}`;
    case 'login-ip':
      return `login-ip:${ipLimitGroup(key.ip)}`;
    case 'register-ip':
      return `register-ip:${ipLimitGroup(key.ip)}`;
  }
}

export class InMemoryAttemptLimiter implements AttemptLimiter {
  /** Claves consumidas, en orden, para comprobar qué contó un use case. */
  readonly consumed: AttemptKey[] = [];
  private readonly counters = new Map<string, Counter>();

  constructor(
    private readonly clock: Clock,
    private readonly windowMs = ATTEMPT_WINDOW_MS,
  ) {}

  consume(key: AttemptKey, limit: number): Promise<AttemptDecision> {
    this.consumed.push(key);
    const now = this.clock.now().getTime();
    const counter = this.live(counterName(key), now) ?? {
      count: 0,
      expiresAt: now + this.windowMs,
    };
    counter.count++;
    this.counters.set(counterName(key), counter);
    if (counter.count <= limit) {
      return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
    }
    return Promise.resolve({
      allowed: false,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((counter.expiresAt - now) / 1000),
      ),
    });
  }

  reset(key: AttemptKey): Promise<void> {
    this.counters.delete(counterName(key));
    return Promise.resolve();
  }

  recordLoginSuccess(email: string, ip: string): Promise<void> {
    this.counters.delete(counterName({ kind: 'login-email', email }));
    const ipName = counterName({ kind: 'login-ip', ip });
    const counter = this.live(ipName, this.clock.now().getTime());
    if (counter) {
      counter.count--;
      if (counter.count <= 0) {
        this.counters.delete(ipName);
      }
    }
    return Promise.resolve();
  }

  /** Intentos contados en la ventana actual. */
  count(key: AttemptKey): number {
    return this.live(counterName(key), this.clock.now().getTime())?.count ?? 0;
  }

  private live(name: string, now: number): Counter | undefined {
    const counter = this.counters.get(name);
    if (counter && counter.expiresAt <= now) {
      this.counters.delete(name);
      return undefined;
    }
    return counter;
  }
}
