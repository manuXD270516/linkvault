import type { Clock } from '../domain/clock';

/** Reloj real del módulo `auth`. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
