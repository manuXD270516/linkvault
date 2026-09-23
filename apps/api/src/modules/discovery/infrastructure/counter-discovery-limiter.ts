import { Inject, Injectable } from '@nestjs/common';
import {
  FIXED_WINDOW_COUNTER,
  type FixedWindowCounter,
} from '../../../infrastructure/limits/fixed-window-counter';
import type {
  DiscoveryLimitDecision,
  DiscoveryLimiter,
} from '../application/ports/discovery-limiter.port';

/** 30 req/min por usuario (D2/D6). Un solo bucket `userId:discovery`. */
export const DISCOVERY_USER_LIMIT = 30;
export const DISCOVERY_USER_WINDOW_MS = 60_000;

/**
 * Rate-limit discovery sobre el contador de plataforma.
 * Fail-open si Redis no responde (ADR-020 §5 / D2).
 */
@Injectable()
export class CounterDiscoveryLimiter implements DiscoveryLimiter {
  constructor(
    @Inject(FIXED_WINDOW_COUNTER) private readonly counter: FixedWindowCounter,
  ) {}

  async consume(userId: string): Promise<DiscoveryLimitDecision> {
    const outcome = await this.counter.consume(`discovery:user:${userId}`, {
      limit: DISCOVERY_USER_LIMIT,
      windowMs: DISCOVERY_USER_WINDOW_MS,
    });
    if (outcome === null) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return outcome;
  }
}
