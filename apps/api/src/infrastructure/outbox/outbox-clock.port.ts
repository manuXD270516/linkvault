// Reloj del outbox (D6 de job-links). Es un puerto propio, distinto del `LINKS_CLOCK` del módulo de dominio: el relay
// decide con él cuándo vence un reintento y cuándo un evento lleva más de 24 h sin publicarse, y los tests lo mueven a
// mano para comprobar cortes largos sin esperas reales.

export const OUTBOX_CLOCK = Symbol('OUTBOX_CLOCK');

export interface OutboxClock {
  now(): Date;
}
