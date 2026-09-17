import type { OutboxClock } from './outbox-clock.port';

/** Reloj real del outbox. */
export class SystemOutboxClock implements OutboxClock {
  now(): Date {
    return new Date();
  }
}
