import { createHmac } from 'node:crypto';
import type { FixedWindowCounter } from '../../../infrastructure/limits/fixed-window-counter';
import type {
  AttemptDecision,
  AttemptKey,
  AttemptLimiter,
} from '../application/ports/attempt-limiter.port';
import { ATTEMPT_WINDOW_MS } from '../domain/attempt-limits';
import { ipLimitGroup } from '../domain/client-ip';

// Límite de intentos de `auth` (D7 de auth-users, ADR-020 §5) sobre el contador por ventana fija de
// `infrastructure/limits`, que es plataforma y lo comparte con `links` (D13 de link-enrichment). Lo que queda aquí es
// lo que sí es de `auth`: cómo se nombra cada contador —el email nunca llega a Redis, se guarda su HMAC—, la IPv6
// agrupada por /64 y el crédito que devuelve un login correcto.
//
// **Falla abierto**: si el contador no responde, la petición sigue sin límite. Negar un login por un Redis lento sería
// peor que dejarlo pasar; el reintento de lectura de `links` decide lo contrario, y por eso la decisión es de quien
// llama y no del contador. Nunca registra emails ni claves.

export interface RedisAttemptLimiterOptions {
  /** `AUTH_JWT_SECRET`: clave del HMAC que evita guardar emails en Redis. */
  readonly secret: string;
  /** Solo los tests la acortan. */
  readonly windowMs?: number;
}

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

export class RedisAttemptLimiter implements AttemptLimiter {
  private readonly secret: string;
  private readonly windowMs: number;

  constructor(
    private readonly counter: FixedWindowCounter,
    options: RedisAttemptLimiterOptions,
  ) {
    this.secret = options.secret;
    this.windowMs = options.windowMs ?? ATTEMPT_WINDOW_MS;
  }

  async consume(key: AttemptKey, limit: number): Promise<AttemptDecision> {
    const outcome = await this.counter.consume(this.nameOf(key), {
      limit,
      windowMs: this.windowMs,
    });
    // Falla abierto: sin contador, la petición pasa.
    return outcome ?? { allowed: true, retryAfterSeconds: 0 };
  }

  async reset(key: AttemptKey): Promise<void> {
    await this.counter.reset(this.nameOf(key));
  }

  async recordLoginSuccess(email: string, ip: string): Promise<void> {
    // El email vuelve a cero y la IP recupera su intento: así la IP solo acumula fallos.
    await this.counter.reset(this.nameOf({ kind: 'login-email', email }));
    await this.counter.giveBack(this.nameOf({ kind: 'login-ip', ip }));
  }

  private nameOf(key: AttemptKey): string {
    return attemptKeyName(key, this.secret);
  }
}
