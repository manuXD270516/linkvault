import {
  acceptsAppliedAt,
  clearsAppliedAt,
  type ApplicationStatus,
} from './application-status';
import { InvalidAppliedAt } from './errors';

// Fecha de postulación (D3, ADR-024 §3). Se decide por el **estado de destino**, nunca por el de origen:
//
// | Destino                                          | Sin fecha enviada   | Con fecha enviada        |
// |--------------------------------------------------|---------------------|--------------------------|
// | applied, in_process, offer, accepted, sin previa | la hora del cambio  | la enviada               |
// | applied, in_process, offer, accepted, con previa | se conserva         | se ignora y se conserva  |
// | saved, interested                                | se borra            | InvalidAppliedAt         |
// | rejected, withdrawn, expired                     | no se toca          | InvalidAppliedAt         |
//
// "Futura" es lo posterior a `now + 24 h`: el SPA omite la fecha cuando la respuesta es "Hoy" y manda la medianoche
// local de otro día, así que ni una zona adelantada ni un reloj de cliente que va por delante rechazan una fecha
// legítima. Una fecha futura se rechaza también cuando se iba a ignorar: es una petición inválida igualmente.

/** Margen sobre el reloj del servidor antes de considerar futura una fecha de postulación. */
export const APPLIED_AT_FUTURE_MARGIN_MS = 24 * 60 * 60 * 1000;

/**
 * `appliedAt` resultante de entrar en `to`. `current` es la fecha que ya tiene la postulación (ausente al crearla) y
 * `requested` la enviada; `undefined` como resultado significa "sin fecha".
 */
export function resolveAppliedAt(params: {
  readonly to: ApplicationStatus;
  readonly current?: Date;
  readonly requested?: Date;
  readonly now: Date;
}): Date | undefined {
  const { to, current, requested, now } = params;
  if (requested !== undefined) {
    if (!acceptsAppliedAt(to) || isInvalidOrFuture(requested, now)) {
      throw new InvalidAppliedAt();
    }
  }
  if (acceptsAppliedAt(to)) {
    return current ?? requested ?? now;
  }
  if (clearsAppliedAt(to)) {
    return undefined;
  }
  return current;
}

function isInvalidOrFuture(date: Date, now: Date): boolean {
  return (
    Number.isNaN(date.getTime()) ||
    date.getTime() > now.getTime() + APPLIED_AT_FUTURE_MARGIN_MS
  );
}
