import type { ApplicationStatus } from './application.schema';

/**
 * Estados abiertos que el auto-expire por cierre de vacante (ADR-037) pasa a `expired`.
 * `accepted` NO entra: la persona ya cerró el proceso a su favor.
 */
export const OPEN_STATUSES_FOR_VACANCY_EXPIRE = [
  'saved',
  'interested',
  'applied',
  'in_process',
  'offer',
] as const satisfies readonly ApplicationStatus[];

export type OpenStatusForVacancyExpire =
  (typeof OPEN_STATUSES_FOR_VACANCY_EXPIRE)[number];

export function isOpenForVacancyExpire(
  status: ApplicationStatus,
): status is OpenStatusForVacancyExpire {
  return (OPEN_STATUSES_FOR_VACANCY_EXPIRE as readonly string[]).includes(
    status,
  );
}
