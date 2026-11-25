import type { Application, GroupTracker, WeeklyPlanAction, WeeklyPlanResponse } from '@linkvault/shared';

/** Dobles de las respuestas de `/api/applications` según el contrato de `@linkvault/shared`. Solo para tests. */

export function applicationWith(overrides: Partial<Application> = {}): Application {
  const linkId = overrides.linkId ?? 'l1';
  return {
    id: `a-${linkId}`,
    linkId,
    status: 'interested',
    visibility: 'private',
    notes: '',
    statusChangedAt: '2026-09-18T10:00:00.000Z',
    version: 1,
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z',
    link: {
      id: linkId,
      displayUrl: `https://www.linkedin.com/jobs/view/${linkId}`,
      platform: 'linkedin',
      previewStatus: 'enriched',
      title: `Oferta ${linkId}`,
      company: 'Acme',
    },
    ...overrides,
  };
}

export function trackerWith(overrides: Partial<GroupTracker> = {}): GroupTracker {
  return { userId: 'u2', displayName: 'Beto', status: 'applied', ...overrides };
}

/** Dobles del plan semanal («Tu semana») según el contrato de `@linkvault/shared`. */
export function weeklyPlanActionWith(overrides: Partial<WeeklyPlanAction> = {}): WeeklyPlanAction {
  return {
    candidateId: 'apply_before_close:a-l1:2026-11-28',
    rule: 'apply_before_close',
    applicationId: 'a-l1',
    linkId: 'l1',
    link: { displayUrl: 'https://www.linkedin.com/jobs/view/l1', title: 'Oferta l1', company: 'Acme' },
    reason: { kind: 'closing_soon', expiresAt: '2026-11-28', daysLeft: 3 },
    ...overrides,
  };
}

export function weeklyPlanWith(
  actions: WeeklyPlanAction[] = [],
  overrides: Partial<WeeklyPlanResponse> = {},
): WeeklyPlanResponse {
  return { weekKey: '2026-W48', planner: 'rules', actions, doneThisWeek: 0, ...overrides };
}
