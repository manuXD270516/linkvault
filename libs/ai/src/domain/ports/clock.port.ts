// Reloj inyectable (D10 de ai-gateway-core). Solo tipos.

export interface Clock {
  /** Milisegundos desde la época Unix. */
  now(): number;
}
