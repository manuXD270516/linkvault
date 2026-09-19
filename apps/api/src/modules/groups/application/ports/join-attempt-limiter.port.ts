// Puerto del límite de intentos de unirse por código (D2 de groups-ownership-join-limit, ADR-025 §6 a §8). El caso de
// uso consume **antes** de resolver el código y devuelve el intento si el código era válido; el adaptador decide las
// claves, los umbrales, el orden de los contadores y qué hacer si el almacén no responde. Solo tipos y el token.

export const JOIN_ATTEMPT_LIMITER = Symbol('JOIN_ATTEMPT_LIMITER');

/** Los dos contadores del join: por usuario y por grupo de IP. */
export type JoinAttemptCounter = 'user' | 'ip';

/** Resultado de consumir un intento de unirse. Se pasa tal cual a `giveBack`. */
export interface JoinAttempt {
  readonly userId: string;
  /** IP del cliente tal como llegó en la petición; el adaptador la agrupa (IPv6 por /64). */
  readonly ip: string;
  /**
   * Contadores en los que el intento cuenta ahora mismo: los que lo consumieron de verdad (su almacén respondió) y no
   * lo devolvieron ya. Vacío si el almacén no respondió en ninguno.
   */
  readonly counted: readonly JoinAttemptCounter[];
  /** `true` si algún contador rechazó el intento: el caso de uso responde `429` sin resolver el código. */
  readonly rejected: boolean;
  /** Segundos de espera del contador que rechazó (entero ≥ 1); 0 si no se rechazó. */
  readonly retryAfterSeconds: number;
}

export interface JoinAttemptLimiter {
  /**
   * Cuenta un intento del usuario y de su IP, en ese orden. Si el del usuario rechaza, el de la IP no se toca; si
   * rechaza el de la IP, el del usuario recupera su intento. El contador que rechaza se queda con el suyo.
   */
  consume(userId: string, ip: string): Promise<JoinAttempt>;
  /**
   * Devuelve el intento en los contadores de `attempt.counted`: el código era válido y no debe contar. No hace nada con
   * un intento rechazado, que se queda en el contador que lo rechazó.
   */
  giveBack(attempt: JoinAttempt): Promise<void>;
}
