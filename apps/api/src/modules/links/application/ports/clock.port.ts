// Reloj inyectable del módulo `links`: `createdAt`, `updatedAt`, `sharedAt` y `savedAt`. Solo tipos y el token.

export const LINKS_CLOCK = Symbol('LINKS_CLOCK');

export interface Clock {
  now(): Date;
}
