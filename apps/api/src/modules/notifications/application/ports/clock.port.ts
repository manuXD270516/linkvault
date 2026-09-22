export const NOTIFICATIONS_CLOCK = Symbol('NOTIFICATIONS_CLOCK');

export interface Clock {
  now(): Date;
}
