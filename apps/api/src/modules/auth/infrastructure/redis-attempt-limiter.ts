import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type {
  AttemptDecision,
  AttemptKey,
  AttemptLimiter,
} from '../application/ports/attempt-limiter.port';
import { ATTEMPT_WINDOW_MS } from '../domain/attempt-limits';
import { ipLimitGroup } from '../domain/client-ip';

// Límite de intentos en Redis (D7 de auth-users, ADR-020 §5): ventana fija por clave. `consume` cuenta antes de verificar
// en un único MULTI (`SET k 0 PX ventana NX`, `INCR k`, `PTTL k`), así que N peticiones concurrentes no superan el límite.
// Falla abierto: si Redis no responde (caído, sin conexión o más de 200 ms por el `commandTimeout` del cliente), la
// petición sigue sin límite. Avisa una sola vez al empezar cada racha de fallos y informa al recuperarse; nunca registra
// emails, claves ni el mensaje del error.

/** Lo que el limitador necesita de un logger; `Logger` de Nest lo cumple. */
export interface AttemptLimiterLogger {
  warn(message: string): void;
  log(message: string): void;
}

export interface RedisAttemptLimiterOptions {
  /** `AUTH_JWT_SECRET`: clave del HMAC que evita guardar emails en Redis. */
  readonly secret: string;
  /** Solo los tests la acortan. */
  readonly windowMs?: number;
}

type RedisCommands = Pick<Redis, 'multi'>;

/** Nombre de la clave de Redis. El email nunca aparece: se guarda `HMAC-SHA256(secret, email)` en hex. */
export function attemptKeyName(key: AttemptKey, secret: string): string {
  switch (key.kind) {
    case 'login-email':
      return `auth:login:email:${emailDigest(key.email, secret)}`;
    case 'login-ip':
      return `auth:login:ip:${ipLimitGroup(key.ip)}`;
    case 'register-ip':
      return `auth:register:ip:${ipLimitGroup(key.ip)}`;
  }
}

function emailDigest(email: string, secret: string): string {
  return createHmac('sha256', secret).update(email, 'utf8').digest('hex');
}

/** Resultados de `EXEC` de ioredis: `[error, valor]` por comando, o `null` si la transacción se abortó. */
type ExecResults = [error: Error | null, result: unknown][] | null;

function resultAt(results: ExecResults, index: number): unknown {
  const entry = results?.[index];
  if (!entry) {
    throw new Error('Redis transaction returned no result');
  }
  const [error, value] = entry;
  if (error) {
    throw error;
  }
  return value;
}

function integerAt(results: ExecResults, index: number): number {
  const value = resultAt(results, index);
  if (typeof value !== 'number') {
    throw new Error('Redis transaction returned a non-integer result');
  }
  return value;
}

export class RedisAttemptLimiter implements AttemptLimiter {
  private readonly secret: string;
  private readonly windowMs: number;
  private failing = false;

  constructor(
    private readonly client: RedisCommands,
    options: RedisAttemptLimiterOptions,
    private readonly logger: AttemptLimiterLogger = new Logger(
      RedisAttemptLimiter.name,
    ),
  ) {
    this.secret = options.secret;
    this.windowMs = options.windowMs ?? ATTEMPT_WINDOW_MS;
  }

  async consume(key: AttemptKey, limit: number): Promise<AttemptDecision> {
    try {
      const decision = await this.count(key, limit);
      this.reportRecovery();
      return decision;
    } catch (error) {
      this.reportFailure(error);
      return { allowed: true, retryAfterSeconds: 0 };
    }
  }

  async reset(key: AttemptKey): Promise<void> {
    await this.failOpen(async () => {
      await this.client.multi().del(attemptKeyName(key, this.secret)).exec();
    });
  }

  async recordLoginSuccess(email: string, ip: string): Promise<void> {
    await this.failOpen(() => this.giveBackLoginAttempt(email, ip));
  }

  private async count(
    key: AttemptKey,
    limit: number,
  ): Promise<AttemptDecision> {
    const name = attemptKeyName(key, this.secret);
    const results: ExecResults = await this.client
      .multi()
      .set(name, '0', 'PX', this.windowMs, 'NX')
      .incr(name)
      .pttl(name)
      .exec();
    const count = integerAt(results, 1);
    if (count <= limit) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    const remainingMs = integerAt(results, 2);
    // Sin caducidad (-1) no debería ocurrir; se anuncia la ventana completa en lugar de un valor inválido.
    const retryAfterMs = remainingMs > 0 ? remainingMs : this.windowMs;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  private async giveBackLoginAttempt(email: string, ip: string): Promise<void> {
    const ipName = attemptKeyName({ kind: 'login-ip', ip }, this.secret);
    const results: ExecResults = await this.client
      .multi()
      .del(attemptKeyName({ kind: 'login-email', email }, this.secret))
      .decr(ipName)
      .exec();
    // Si la ventana de la IP ya había expirado, DECR crea la clave en -1 y sin caducidad: se borra, y un contador que
    // vuelve a 0 también, para que la IP no acumule crédito ni quede una clave eterna.
    if (integerAt(results, 1) <= 0) {
      await this.client.multi().del(ipName).exec();
    }
  }

  private async failOpen(work: () => Promise<void>): Promise<void> {
    try {
      await work();
      this.reportRecovery();
    } catch (error) {
      this.reportFailure(error);
    }
  }

  private reportFailure(error: unknown): void {
    if (this.failing) {
      return;
    }
    this.failing = true;
    const name = error instanceof Error ? error.name : 'UnknownError';
    this.logger.warn(
      `Attempt limiter store unavailable (${name}), allowing requests without limits`,
    );
  }

  private reportRecovery(): void {
    if (!this.failing) {
      return;
    }
    this.failing = false;
    this.logger.log('Attempt limiter store available again');
  }
}
