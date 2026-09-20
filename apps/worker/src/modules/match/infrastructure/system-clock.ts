import type { Clock } from '../application/ports/clock.port';

/** Reloj real del módulo `match` del worker. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
