import type {
  JoinAttempt,
  JoinAttemptCounter,
  JoinAttemptLimiter,
} from '../ports/join-attempt-limiter.port';

// Doble en memoria de JOIN_ATTEMPT_LIMITER para los tests de application (D4 de groups-ownership-join-limit). No es un
// adaptador de producción: el real es `CounterJoinAttemptLimiter`. Aplica el mismo orden (usuario primero; la IP solo si
// el usuario deja pasar; si la IP rechaza, el usuario recupera su intento) sin ventana de tiempo ni agrupación de IP, y
// guarda cada `giveBack` para que un test compruebe cuántas veces y con qué intento se llamó.

export interface InMemoryJoinAttemptLimits {
  readonly userLimit?: number;
  readonly ipLimit?: number;
  readonly retryAfterSeconds?: number;
}

export class InMemoryJoinAttemptLimiter implements JoinAttemptLimiter {
  /** Con `true`, el almacén "no responde": ningún contador cuenta y nada se rechaza (falla abierto). */
  unavailable = false;
  readonly givenBack: JoinAttempt[] = [];
  private readonly users = new Map<string, number>();
  private readonly ips = new Map<string, number>();
  private readonly userLimit: number;
  private readonly ipLimit: number;
  private readonly retryAfterSeconds: number;

  constructor(limits: InMemoryJoinAttemptLimits = {}) {
    this.userLimit = limits.userLimit ?? 10;
    this.ipLimit = limits.ipLimit ?? 100;
    this.retryAfterSeconds = limits.retryAfterSeconds ?? 900;
  }

  /** Intentos que cuentan ahora mismo para el usuario. */
  attemptsOfUser(userId: string): number {
    return this.users.get(userId) ?? 0;
  }

  /** Intentos que cuentan ahora mismo para la IP. */
  attemptsOfIp(ip: string): number {
    return this.ips.get(ip) ?? 0;
  }

  consume(userId: string, ip: string): Promise<JoinAttempt> {
    if (this.unavailable) {
      return Promise.resolve(this.attempt(userId, ip, [], false));
    }
    if (increment(this.users, userId) > this.userLimit) {
      return Promise.resolve(this.attempt(userId, ip, ['user'], true));
    }
    if (increment(this.ips, ip) > this.ipLimit) {
      decrement(this.users, userId);
      return Promise.resolve(this.attempt(userId, ip, ['ip'], true));
    }
    return Promise.resolve(this.attempt(userId, ip, ['user', 'ip'], false));
  }

  giveBack(attempt: JoinAttempt): Promise<void> {
    this.givenBack.push(attempt);
    if (attempt.rejected) {
      return Promise.resolve();
    }
    for (const counter of attempt.counted) {
      if (counter === 'user') {
        decrement(this.users, attempt.userId);
      } else {
        decrement(this.ips, attempt.ip);
      }
    }
    return Promise.resolve();
  }

  private attempt(
    userId: string,
    ip: string,
    counted: readonly JoinAttemptCounter[],
    rejected: boolean,
  ): JoinAttempt {
    return {
      userId,
      ip,
      counted,
      rejected,
      retryAfterSeconds: rejected ? this.retryAfterSeconds : 0,
    };
  }
}

function increment(counters: Map<string, number>, key: string): number {
  const count = (counters.get(key) ?? 0) + 1;
  counters.set(key, count);
  return count;
}

function decrement(counters: Map<string, number>, key: string): void {
  const count = (counters.get(key) ?? 0) - 1;
  if (count <= 0) {
    counters.delete(key);
  } else {
    counters.set(key, count);
  }
}
