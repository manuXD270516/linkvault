// Reloj inyectable (misma forma que el de `api`). Solo tipos y el token: un caso de uso que llamara a `Date.now()`
// no se podría probar sin esperar de verdad.

export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}
