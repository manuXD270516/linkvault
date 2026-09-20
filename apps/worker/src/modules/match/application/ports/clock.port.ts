// Reloj inyectable del módulo `match` del worker (tarea 13.2).

export const MATCH_CLOCK = Symbol('MATCH_CLOCK');

export interface Clock {
  now(): Date;
}
