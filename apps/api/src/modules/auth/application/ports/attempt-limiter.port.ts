// Puerto de límite de intentos (D7 de auth-users). El use case nombra qué cuenta (email del login, IP del login o IP del
// registro) y el límite; el adaptador decide la clave, su protección (HMAC del email) y el almacén. Solo tipos y token.

export const ATTEMPT_LIMITER = Symbol('ATTEMPT_LIMITER');

export type AttemptKey =
  /** Email ya normalizado. Cuenta login y `currentPassword` del cambio de contraseña. */
  | { readonly kind: 'login-email'; readonly email: string }
  /** IP del cliente tal como llega en la petición. */
  | { readonly kind: 'login-ip'; readonly ip: string }
  | { readonly kind: 'register-ip'; readonly ip: string };

export interface AttemptDecision {
  readonly allowed: boolean;
  /** Segundos hasta que se reinicia la ventana si no se permite (entero ≥ 1); 0 si se permite. */
  readonly retryAfterSeconds: number;
}

export interface AttemptLimiter {
  /**
   * Cuenta un intento **antes** de verificar y dice si cabe en el límite de la ventana actual. Atómico: N peticiones
   * concurrentes no superan el límite.
   */
  consume(key: AttemptKey, limit: number): Promise<AttemptDecision>;
  /** Pone a cero un contador. */
  reset(key: AttemptKey): Promise<void>;
  /**
   * Login correcto: pone a cero el contador del email y descuenta el intento de la IP, para que la IP solo acumule
   * fallos. `email` ya normalizado.
   */
  recordLoginSuccess(email: string, ip: string): Promise<void>;
}
