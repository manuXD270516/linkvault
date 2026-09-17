// Reloj inyectable del módulo `users`: fecha de alta y `passwordChangedAt`. Solo tipos y el token.

export const USERS_CLOCK = Symbol('USERS_CLOCK');

export interface Clock {
  now(): Date;
}
