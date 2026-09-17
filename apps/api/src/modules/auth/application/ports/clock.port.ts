// Puerto CLOCK del módulo `auth` (D1 de auth-users). El tipo vive en el dominio, que lo usa en `RefreshSessionPolicy`.

export type { Clock } from '../../domain/clock';

export const CLOCK = Symbol('AUTH_CLOCK');
