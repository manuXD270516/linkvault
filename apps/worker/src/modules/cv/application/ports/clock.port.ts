// Reloj inyectable del módulo `cv` del worker (misma forma que el de `enrichment`). Solo tipos y el token: un caso de
// uso que llamara a `Date.now()` no se podría probar sin esperar de verdad, y aquí se prueba un plazo.

export const CV_CLOCK = Symbol('CV_CLOCK');

export interface Clock {
  now(): Date;
}
