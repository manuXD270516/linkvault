/** Decisión del rate-limit por usuario (30/min, fail-open si Redis cae). */
export interface DiscoveryLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

export const DISCOVERY_LIMITER = Symbol('DISCOVERY_LIMITER');

/**
 * Rate-limit `userId:discovery` (D2/D6). Un solo bucket aunque `board=all`.
 * Fail-open si el contador no responde (ADR-020 §5).
 */
export interface DiscoveryLimiter {
  consume(userId: string): Promise<DiscoveryLimitDecision>;
}
