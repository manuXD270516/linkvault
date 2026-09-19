// Estados canónicos de una postulación (ADR-004) con transiciones libres (ADR-024 §1): la máquina NO guarda una tabla de
// pares permitidos. Desde cualquier estado se puede ir a cualquier otro —avanzar saltando etapas, retroceder para
// corregir, cerrar desde cualquier estado y reabrir un cierre—, y el historial guarda origen y destino de cada cambio.
//
// Mismas listas que `APPLICATION_STATUSES`, `CLOSED_STATUSES` y `APPLIED_AT_STATUSES` de `@linkvault/shared`, repetidas
// aquí para que el dominio no dependa del contrato HTTP; un test comprueba que coinciden.

export const APPLICATION_STATUSES = [
  'saved',
  'interested',
  'applied',
  'in_process',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
  'expired',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Cierres. `accepted` no lo es. */
export const CLOSED_STATUSES = ['rejected', 'withdrawn', 'expired'] as const;

/** Estados "de postulada": al entrar en ellos se fija `appliedAt` si falta (D3). */
export const APPLIED_AT_STATUSES = [
  'applied',
  'in_process',
  'offer',
  'accepted',
] as const;

/** Estados en los que `appliedAt` se borra al entrar: deshacer un "Postulé" por error (D3). */
export const PRE_APPLICATION_STATUSES = ['saved', 'interested'] as const;

/** El único estado que admite una etapa libre. */
export const STAGE_STATUS: ApplicationStatus = 'in_process';

export function isApplicationStatus(value: string): value is ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value);
}

export function isClosedStatus(status: ApplicationStatus): boolean {
  return (CLOSED_STATUSES as readonly ApplicationStatus[]).includes(status);
}

/** `true` si el estado admite `appliedAt` en la petición y la fija al entrar si falta. */
export function acceptsAppliedAt(status: ApplicationStatus): boolean {
  return (APPLIED_AT_STATUSES as readonly ApplicationStatus[]).includes(status);
}

/** `true` si entrar en el estado borra `appliedAt`. */
export function clearsAppliedAt(status: ApplicationStatus): boolean {
  return (PRE_APPLICATION_STATUSES as readonly ApplicationStatus[]).includes(
    status,
  );
}

/** Estado canónico con su etapa, lo único que protege la versión (ADR-024 §4). */
export interface ApplicationState {
  readonly status: ApplicationStatus;
  /** Solo con `in_process`; ausente si no hay etapa. */
  readonly stageLabel?: string;
}

/**
 * `true` si dos estados son el mismo: mismo estado canónico y misma etapa. Pedir el estado que ya se tiene es "sin
 * cambios": ni escribe, ni mira la versión, ni deja evento (D5).
 */
export function isSameState(
  left: ApplicationState,
  right: ApplicationState,
): boolean {
  return left.status === right.status && left.stageLabel === right.stageLabel;
}
