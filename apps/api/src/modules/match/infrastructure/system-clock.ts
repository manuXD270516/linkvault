import type { MatchClock } from '../application/ports/clock.port';

/** Reloj real del módulo `match`. */
export class SystemMatchClock implements MatchClock {
  now(): Date {
    return new Date();
  }
}
