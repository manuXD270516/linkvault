// Reloj inyectable del módulo `cv`: la fecha de subida de un CV. Solo tipos y el token, para que los tests fijen la
// hora en vez de esperar a que pase.

export const CV_CLOCK = Symbol('CV_CLOCK');

export interface Clock {
  now(): Date;
}
