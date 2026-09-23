// Dataset fijo del seed local (design D2–D3 / ADR-042). Claves de upsert documentadas aquí.

/** Credenciales demo — solo locales; nunca en compose prod. */
export const DEMO_ANA = {
  email: 'ana@demo.linkvault.local',
  password: 'Demo-pass-Ana-12345!',
  displayName: 'Ana Demo',
} as const;

export const DEMO_BOB = {
  email: 'bob@demo.linkvault.local',
  password: 'Demo-pass-Bob-12345!',
  displayName: 'Bob Demo',
} as const;

/** Nombre del grupo demo (upsert: membresía de Ana + este nombre). */
export const DEMO_GROUP_NAME = 'Demo LatAm';

/**
 * Código de invitación fijo del grupo demo (alfabeto D3 de groups, sin I/L/O/0/1).
 * Upsert del grupo: `findByInviteCode` → crear con este código si falta.
 */
export const DEMO_GROUP_INVITE_CODE = 'SEEDD3M2';

/** SPA local impresa al terminar. */
export const DEMO_SPA_URL = 'http://localhost:4200';

/** Texto del único comentario seed (idempotencia por texto en la relación). */
export const DEMO_COMMENT_TEXT =
  'Comentario demo del grupo LatAm — seed LinkVault.';

/** Nombre del CV best-effort de Ana. */
export const DEMO_CV_FILE_NAME = 'ana-demo-cv.pdf';

/**
 * Links seed: upsert por `normalizedUrl` / `dedupeKey` vía SaveLink.
 * Al menos uno abierto con salary+modality y uno cerrado `recheck`.
 */
export const DEMO_LINKS = {
  openSalary: {
    url: 'https://demo.linkvault.local/jobs/backend-open',
    title: 'Backend Engineer (Demo)',
    company: 'Demo LatAm Corp',
    location: 'La Paz, Bolivia',
    modality: 'remote' as const,
    salary: {
      min: 4000,
      max: 6000,
      currency: 'USD',
      period: 'month' as const,
    },
    appStatus: 'applied' as const,
  },
  closedRecheck: {
    url: 'https://demo.linkvault.local/jobs/frontend-closed',
    title: 'Frontend Engineer (Cerrada)',
    company: 'Demo LatAm Corp',
    location: 'Santa Cruz, Bolivia',
    modality: 'hybrid' as const,
    salary: {
      min: 15_000,
      max: 22_000,
      currency: 'BOB',
      period: 'month' as const,
    },
    appStatus: 'in_process' as const,
    stageLabel: 'Entrevista técnica',
  },
  rejectedApp: {
    url: 'https://demo.linkvault.local/jobs/qa-rejected',
    title: 'QA Analyst (Demo)',
    company: 'Acme Bolivia',
    location: 'Cochabamba, Bolivia',
    modality: 'onsite' as const,
    appStatus: 'rejected' as const,
  },
  staleApp: {
    url: 'https://demo.linkvault.local/jobs/mobile-stale',
    title: 'Mobile Developer (Stale)',
    company: 'Startup Andes',
    location: 'Remote LatAm',
    modality: 'remote' as const,
    appStatus: 'applied' as const,
    /** Días hacia atrás para `statusChangedAt` (≥11). */
    staleDays: 11,
  },
} as const;

export type DemoLinkKey = keyof typeof DEMO_LINKS;
