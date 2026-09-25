import type { ApplicationStatus } from '@linkvault/shared';

/**
 * Nombre neutro de cada estado, el único mapa del SPA (D11, business 2 y 9). Neutro a propósito: el mismo texto sirve
 * para la persona ("Tu estado: Postulada") y para los demás ("Beto · postulación: Postulada"). Los gestos, en primera
 * persona ("Me interesa", "Postulé"), y los títulos de columna viven aparte.
 */
export function statusLabel(status: ApplicationStatus): string {
  switch (status) {
    case 'saved':
      return $localize`:@@applications.status.saved:Guardada`;
    case 'interested':
      return $localize`:@@applications.status.interested:Interés`;
    case 'applied':
      return $localize`:@@applications.status.applied:Postulada`;
    case 'in_process':
      return $localize`:@@applications.status.inProcess:En proceso`;
    case 'offer':
      return $localize`:@@applications.status.offer:Oferta`;
    case 'accepted':
      return $localize`:@@applications.status.accepted:Aceptada`;
    case 'rejected':
      return $localize`:@@applications.status.rejected:Rechazada`;
    case 'withdrawn':
      return $localize`:@@applications.status.withdrawn:Retirada`;
    case 'expired':
      return $localize`:@@applications.status.expired:Expirada`;
  }
}

/** Columnas del tablero, en su orden. "Interés" recoge también `saved`; "Cerradas", los tres cierres (business 6). */
export type BoardColumnId = 'interest' | 'applied' | 'in_process' | 'offer' | 'accepted' | 'closed';

export const BOARD_COLUMNS: readonly BoardColumnId[] = [
  'interest',
  'applied',
  'in_process',
  'offer',
  'accepted',
  'closed',
];

export function columnTitle(column: BoardColumnId): string {
  switch (column) {
    case 'interest':
      return $localize`:@@applications.column.interest:Interés`;
    case 'applied':
      return $localize`:@@applications.column.applied:Postuladas`;
    case 'in_process':
      return $localize`:@@applications.column.inProcess:En proceso`;
    case 'offer':
      return $localize`:@@applications.column.offer:Con oferta`;
    case 'accepted':
      return $localize`:@@applications.column.accepted:Aceptadas`;
    case 'closed':
      return $localize`:@@applications.column.closed:Cerradas`;
  }
}

export function columnOf(status: ApplicationStatus): BoardColumnId {
  switch (status) {
    case 'saved':
    case 'interested':
      return 'interest';
    case 'rejected':
    case 'withdrawn':
    case 'expired':
      return 'closed';
    default:
      return status;
  }
}

/** Los tres cierres, en el orden en que se ofrecen al soltar en "Cerradas". */
export const CLOSING_STATUSES: readonly ApplicationStatus[] = ['rejected', 'withdrawn', 'expired'];

/** "Mover a…" ofrece todos los estados salvo `saved`, que la UI no ofrece nunca (ADR-024 §1). */
export const MOVABLE_STATUSES: readonly ApplicationStatus[] = [
  'interested',
  'applied',
  'in_process',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
  'expired',
];

/** Estados "de postulada": entrar en ellos sin fecha previa pregunta "¿Cuándo postulaste?" (D3, D11). */
export function asksAppliedDate(status: ApplicationStatus): boolean {
  return status === 'applied' || status === 'in_process' || status === 'offer' || status === 'accepted';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Días de calendario local entre la fecha de postulación y hoy: "hoy" es el mismo día en el reloj de quien mira, aunque
 * hayan pasado menos de 24 h desde ayer por la noche. Una fecha futura cuenta como hoy.
 */
export function daysSinceApplied(appliedAt: string, now: Date): number {
  const applied = new Date(appliedAt);
  const from = Date.UTC(applied.getFullYear(), applied.getMonth(), applied.getDate());
  const to = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

// TEMPORARY (i18n-catalog-gate, task 4.1): unextracted unit to prove CI fails. Reverted before merge.
export const i18nGateProbe = $localize`:@@links.snack.newNotice:Link guardado`;
