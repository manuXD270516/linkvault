// Reloj inyectable del módulo `groups`: `createdAt`, `updatedAt` y `joinedAt`. Solo tipos y el token.

export const GROUPS_CLOCK = Symbol('GROUPS_CLOCK');

export interface Clock {
  now(): Date;
}
