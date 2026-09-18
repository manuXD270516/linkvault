import type { OutboxClock } from '../outbox-clock.port';

/**
 * Reloj del outbox que solo avanza cuando se lo piden. Los tests del relay comprueban esperas de horas (backoff y
 * agotamiento a las 24 h) sin esperar nada de verdad.
 */
export class MovableOutboxClock implements OutboxClock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  /** Adelanta el reloj los milisegundos indicados. */
  advanceBy(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }

  /** Coloca el reloj en un instante concreto. */
  set(instant: Date): void {
    this.current = new Date(instant);
  }
}
