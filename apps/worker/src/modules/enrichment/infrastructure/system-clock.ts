import { Injectable } from '@nestjs/common';
import type { Clock } from '../application/ports/clock.port';

/** El reloj de verdad. Lo sustituye un doble en los tests, que es la única razón de que exista el puerto. */
@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
