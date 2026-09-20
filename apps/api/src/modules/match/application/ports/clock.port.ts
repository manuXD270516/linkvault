// Reloj inyectable del módulo `match`: la fecha de petición y el vencimiento de un `running`. Solo tipos y el token.

export const MATCH_CLOCK = Symbol('MATCH_CLOCK');

export interface MatchClock {
  now(): Date;
}
