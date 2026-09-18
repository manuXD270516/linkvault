import type { Clock } from '../application/ports/clock.port';

/** Reloj real del módulo `links`. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
