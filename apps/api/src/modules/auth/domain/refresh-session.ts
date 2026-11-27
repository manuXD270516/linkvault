import type { Clock } from './clock';
import type { InvalidRefreshReason } from './errors';

// Reglas de sesión y rotación del refresh token (D4 de auth-users, ADR-020). Puras y con reloj inyectado: el repositorio
// las aplica dentro de la transacción de rotación y actúa según el resultado (marcar y crear el sucesor, revocar la
// sesión o nada); el código HTTP se decide fuera.

/** Un token rotado hace menos de esto es un refresh concurrente del mismo navegador; a partir de aquí, reuso. */
export const REFRESH_CONFLICT_WINDOW_MS = 10_000;

/** Reemisiones máximas de un token rotado dentro de la ventana (ADR-072, D4 de session-refresh-abort). */
export const REFRESH_REISSUE_LIMIT = 3;

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
  /** La familia ya avanzó más allá de este token: su sucesor (o un hermano de este) se usó, o quedó superado. */
  readonly advanced: boolean;
  /** Reemisiones hechas; `null` si el token se rotó antes de que existiera la reemisión (nunca se reemite). */
  readonly reissueCount: number | null;
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
  /**
   * Rotado hace menos de 10 s y con el sucesor sin usar: la respuesta de la rotación se dio por perdida. Emitir un
   * refresh token hermano (hijo del presentado) que caduca en `successorExpiresAt`; `rotatedAt` no se mueve.
   */
  | {
      readonly outcome: 'reissue';
      readonly now: Date;
      readonly successorExpiresAt: Date;
    }
  /** Rotado hace menos de 10 s con el sucesor ya usado, superado o tope alcanzado: 409 sin revocar ni emitir cookie. */
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
    const successorExpiresAt = earliest(
      addDays(now, this.settings.refreshTtlDays),
      session.expiresAt,
    );
    if (token.rotatedAt !== null) {
      if (
        now.getTime() - token.rotatedAt.getTime() >=
        REFRESH_CONFLICT_WINDOW_MS
      ) {
        return { outcome: 'reuse' };
      }
      return !token.advanced &&
        token.reissueCount !== null &&
        token.reissueCount < REFRESH_REISSUE_LIMIT
        ? { outcome: 'reissue', now, successorExpiresAt }
        : { outcome: 'conflict' };
    }
    return { outcome: 'rotate', now, successorExpiresAt };
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
