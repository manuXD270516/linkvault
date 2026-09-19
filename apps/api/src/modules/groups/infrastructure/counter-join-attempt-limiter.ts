import { Inject, Injectable } from '@nestjs/common';
import { ipLimitGroup } from '../../../infrastructure/limits/client-ip';
import {
  FIXED_WINDOW_COUNTER,
  type FixedWindowCounter,
  type WindowLimit,
} from '../../../infrastructure/limits/fixed-window-counter';
import type {
  JoinAttempt,
  JoinAttemptCounter,
  JoinAttemptLimiter,
} from '../application/ports/join-attempt-limiter.port';
import {
  JOIN_ATTEMPT_WINDOW_MS,
  JOIN_ATTEMPTS_PER_IP,
  JOIN_ATTEMPTS_PER_USER,
} from '../domain/limits';

// Adaptador de JOIN_ATTEMPT_LIMITER sobre el contador de plataforma (D2 de groups-ownership-join-limit, ADR-025 §6 a §8).
//
// - Claves `groups:join:user:<userId>` y `groups:join:ip:<grupo de IP>` (IPv4 tal cual, IPv6 por /64), las que cita el
//   RUNBOOK para liberar a alguien.
// - Consumo **en secuencia**: primero el usuario; la IP solo si el usuario deja pasar, para que un usuario bloqueado que
//   insiste no agote la IP de sus compañeros. Si la IP rechaza, el usuario recupera su intento.
// - Devolución **en paralelo**: las dos no dependen entre sí.
// - Falla abierto: un contador que devuelve `null` no cuenta ni rechaza. No registra nada: el contador ya avisa una vez
//   por racha de fallos, sin la clave.

const USER_LIMIT: WindowLimit = {
  limit: JOIN_ATTEMPTS_PER_USER,
  windowMs: JOIN_ATTEMPT_WINDOW_MS,
};
const IP_LIMIT: WindowLimit = {
  limit: JOIN_ATTEMPTS_PER_IP,
  windowMs: JOIN_ATTEMPT_WINDOW_MS,
};

export function joinUserKey(userId: string): string {
  return `groups:join:user:${userId}`;
}

export function joinIpKey(ip: string): string {
  return `groups:join:ip:${ipLimitGroup(ip)}`;
}

@Injectable()
export class CounterJoinAttemptLimiter implements JoinAttemptLimiter {
  constructor(
    @Inject(FIXED_WINDOW_COUNTER) private readonly counter: FixedWindowCounter,
  ) {}

  async consume(userId: string, ip: string): Promise<JoinAttempt> {
    const user = await this.counter.consume(joinUserKey(userId), USER_LIMIT);
    if (user !== null && !user.allowed) {
      return attempt(userId, ip, ['user'], user.retryAfterSeconds);
    }
    const byIp = await this.counter.consume(joinIpKey(ip), IP_LIMIT);
    if (byIp !== null && !byIp.allowed) {
      if (user !== null) {
        // El contador que no rechazó recupera su intento. Si el almacén no responde, se pierde: falla abierto.
        await this.counter.giveBack(joinUserKey(userId));
      }
      return attempt(userId, ip, ['ip'], byIp.retryAfterSeconds);
    }
    const counted: JoinAttemptCounter[] = [];
    if (user !== null) {
      counted.push('user');
    }
    if (byIp !== null) {
      counted.push('ip');
    }
    return attempt(userId, ip, counted);
  }

  async giveBack(joinAttempt: JoinAttempt): Promise<void> {
    if (joinAttempt.rejected) {
      return;
    }
    await Promise.all(
      joinAttempt.counted.map((counter) =>
        this.counter.giveBack(
          counter === 'user'
            ? joinUserKey(joinAttempt.userId)
            : joinIpKey(joinAttempt.ip),
        ),
      ),
    );
  }
}

/** Intento consumido; con `retryAfterSeconds` es un rechazo del contador que lo dio. */
function attempt(
  userId: string,
  ip: string,
  counted: readonly JoinAttemptCounter[],
  retryAfterSeconds?: number,
): JoinAttempt {
  return {
    userId,
    ip,
    counted,
    rejected: retryAfterSeconds !== undefined,
    retryAfterSeconds: retryAfterSeconds ?? 0,
  };
}
