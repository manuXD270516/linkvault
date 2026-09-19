import type { Application, GroupTracker } from '@linkvault/shared';

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
