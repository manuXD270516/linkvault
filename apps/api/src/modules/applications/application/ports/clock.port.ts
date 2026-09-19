// Reloj inyectable del módulo `applications`: fechas de alta y de cambio, `appliedAt` "hoy" y el margen de las fechas
// futuras (D3). Solo tipos y el token.

export const APPLICATIONS_CLOCK = Symbol('APPLICATIONS_CLOCK');

export interface Clock {
  now(): Date;
}
