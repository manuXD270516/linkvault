// Errores de dominio del módulo discovery (ADR-043 / job-discovery).

export type DiscoveryErrorCode =
  | 'discovery_disabled'
  | 'too_many_attempts';

export abstract class DiscoveryError extends Error {
  abstract readonly code: DiscoveryErrorCode;
}

/** `FEATURE_DISCOVERY=false` → 503. */
export class DiscoveryDisabled extends DiscoveryError {
  override readonly name = 'DiscoveryDisabled';
  readonly code = 'discovery_disabled';

  constructor() {
    super('Discovery is disabled');
  }
}

/** Rate-limit usuario agotado → 429 + Retry-After. */
export class TooManyDiscoveryAttempts extends DiscoveryError {
  override readonly name = 'TooManyDiscoveryAttempts';
  readonly code = 'too_many_attempts';
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Too many attempts');
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}
