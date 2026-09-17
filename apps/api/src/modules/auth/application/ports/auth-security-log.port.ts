// Puerto de eventos de seguridad de `auth` (D4 y D10 de auth-users). Cada método recibe solo identificadores: por su
// tipo no puede llevar tokens, contraseñas, hashes ni emails. Solo tipos y el token.

export const AUTH_SECURITY_LOG = Symbol('AUTH_SECURITY_LOG');

export interface SessionEvent {
  readonly userId: string;
  readonly sessionId: string;
}

export interface AuthSecurityLog {
  /** Se presentó un refresh token rotado hace 10 s o más; la sesión ya quedó revocada. */
  refreshTokenReused(event: SessionEvent): void;
}
