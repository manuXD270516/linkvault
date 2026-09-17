import type { Clock } from './clock';
import type { InvalidRefreshReason } from './errors';

// Reglas de sesión y rotación del refresh token (D4 de auth-users, ADR-020). Puras y con reloj inyectado: el repositorio
// las aplica dentro de la transacción de rotación y actúa según el resultado (marcar y crear el sucesor, revocar la
// sesión o nada); el código HTTP se decide fuera.

/** Un token rotado hace menos de esto es un refresh concurrente del mismo navegador; a partir de aquí, reuso. */
export const REFRESH_CONFLICT_WINDOW_MS = 10_000;

const DAY_MS = 86_400_000;

export interface RefreshSessionSettings {
  /** Caducidad deslizante de cada refresh token (`AUTH_REFRESH_TTL_DAYS`). */
  readonly refreshTtlDays: number;
  /** Máximo absoluto de la sesión desde el login o registro (`AUTH_REFRESH_MAX_DAYS`). */
  readonly refreshMaxDays: number;
}

export interface SessionState {
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface RefreshTokenState {
  readonly expiresAt: Date;
  readonly rotatedAt: Date | null;
}

/** Fechas de una sesión nueva y de su primer refresh token. */
export interface SessionWindow {
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly refreshExpiresAt: Date;
}

export type RefreshDecision =
  /** Marcar el token como rotado en `now` y emitir un sucesor que caduca en `successorExpiresAt`. */
  | {
      readonly outcome: 'rotate';
      readonly now: Date;
      readonly successorExpiresAt: Date;
    }
  /** Rotado hace menos de 10 s: 409 sin revocar ni emitir cookie. */
  | { readonly outcome: 'conflict' }
  /** Rotado hace 10 s o más: revocar la sesión completa y responder `invalid_refresh`. */
  | { readonly outcome: 'reuse' }
  | { readonly outcome: 'invalid'; readonly reason: InvalidRefreshReason };

export class RefreshSessionPolicy {
  constructor(
    private readonly clock: Clock,
    private readonly settings: RefreshSessionSettings,
  ) {
    const { refreshTtlDays, refreshMaxDays } = settings;
    if (
      !Number.isInteger(refreshTtlDays) ||
      !Number.isInteger(refreshMaxDays) ||
      refreshTtlDays < 1 ||
      refreshMaxDays < refreshTtlDays
    ) {
      throw new RangeError(
        'Refresh settings must be positive whole days with refreshTtlDays <= refreshMaxDays',
      );
    }
  }

  /** Sesión que abre un login o registro: máximo absoluto desde ahora y primer token con la caducidad deslizante. */
  openSession(): SessionWindow {
    const now = this.clock.now();
    const expiresAt = addDays(now, this.settings.refreshMaxDays);
    return {
      createdAt: now,
      expiresAt,
      refreshExpiresAt: earliest(
        addDays(now, this.settings.refreshTtlDays),
        expiresAt,
      ),
    };
  }

  /**
   * Decide qué hacer con un refresh token presentado (pasos 1–2 de D4): primero validez de token y sesión (una sesión
   * revocada o caducada gana a la detección de reuso), después la ventana de conflicto y, si no se rotó, la rotación con
   * caducidad deslizante acotada por el máximo de la sesión.
   */
  decide(
    token: RefreshTokenState | null,
    session: SessionState | null,
  ): RefreshDecision {
    const now = this.clock.now();
    if (!token) {
      return { outcome: 'invalid', reason: 'unknown_token' };
    }
    if (!session) {
      return { outcome: 'invalid', reason: 'session_missing' };
    }
    if (session.revokedAt !== null) {
      return { outcome: 'invalid', reason: 'session_revoked' };
    }
    if (isExpired(token.expiresAt, now)) {
      return { outcome: 'invalid', reason: 'token_expired' };
    }
    if (isExpired(session.expiresAt, now)) {
      return { outcome: 'invalid', reason: 'session_expired' };
    }
    if (token.rotatedAt !== null) {
      return now.getTime() - token.rotatedAt.getTime() <
        REFRESH_CONFLICT_WINDOW_MS
        ? { outcome: 'conflict' }
        : { outcome: 'reuse' };
    }
    return {
      outcome: 'rotate',
      now,
      successorExpiresAt: earliest(
        addDays(now, this.settings.refreshTtlDays),
        session.expiresAt,
      ),
    };
  }

  /** Comprobación del paso 4 de D4, dentro de la transacción, antes de insertar el sucesor. */
  isSessionActive(session: SessionState | null): boolean {
    return (
      session !== null &&
      session.revokedAt === null &&
      !isExpired(session.expiresAt, this.clock.now())
    );
  }
}

/** Caducado en el instante exacto de `expiresAt`. */
function isExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function earliest(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}
