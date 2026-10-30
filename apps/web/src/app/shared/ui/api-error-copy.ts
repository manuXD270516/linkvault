import type { ApiErrorCode } from '@linkvault/shared';

/**
 * Decisión de texto de cada código de error de la API (ADR-062 §3, spec web/request-errors).
 * - `common`: el componente común (`lv-request-error`) tiene texto propio para el código.
 * - `local`: lo traducen los ficheros que nombra (rutas bajo `apps/web/src/app`), que **comparan** el código.
 * - `fallback`: basta el mensaje por clase de estado; `reason` dice por qué.
 * - `unreachable`: el SPA no ofrece el camino que lo produce, o lo resuelve sin mostrar texto; `reason` dice por qué.
 */
export type ApiErrorCopy =
  | { readonly copy: 'common' }
  | { readonly copy: 'local'; readonly files: readonly [string, ...string[]] }
  | { readonly copy: 'fallback'; readonly reason: string }
  | { readonly copy: 'unreachable'; readonly reason: string };

/**
 * Una entrada por cada valor de `apiErrorCodeSchema` y ninguna más: `satisfies Record<ApiErrorCode, …>` hace fallar
 * `web:typecheck` si falta o sobra una. El change que añade un código añade su entrada en el mismo PR.
 * Solo `import type` de `@linkvault/shared`: importar el valor metería zod en el bundle inicial.
 */
export const API_ERROR_COPY = {
  validation_error: {
    copy: 'local',
    files: [
      'features/links/link-list.component.ts',
      'features/profile/profile.page.ts',
    ],
  },
  invalid_credentials: {
    copy: 'local',
    files: [
      'features/auth/login.page.ts',
      'features/profile/delete-account.dialog.ts',
      'features/profile/profile.page.ts',
    ],
  },
  email_taken: { copy: 'local', files: ['features/auth/register.page.ts'] },
  too_many_attempts: { copy: 'common' },
  invalid_refresh: {
    copy: 'unreachable',
    reason:
      'la renovación fallida cierra la sesión y lleva a /login (core/auth); ningún formulario lo muestra',
  },
  refresh_conflict: { copy: 'local', files: ['core/auth/auth.api.ts'] },
  csrf_header_missing: {
    copy: 'unreachable',
    reason:
      'el SPA siempre envía X-Requested-With; si llega es un defecto del SPA',
  },
  unauthorized: { copy: 'local', files: ['core/auth/auth.interceptor.ts'] },
  invalid_token: {
    copy: 'local',
    files: [
      'features/auth/reset-password.page.ts',
      'features/auth/verify-email.page.ts',
    ],
  },
  unsupported_media_type: {
    copy: 'unreachable',
    reason:
      'el SPA siempre envía JSON o multipart; si llega es un defecto del SPA',
  },
  group_not_found: {
    copy: 'local',
    files: [
      'features/groups/group-detail.page.ts',
      'features/links/comments.dialog.ts',
      'features/links/link-list.component.ts',
    ],
  },
  member_not_found: { copy: 'common' },
  forbidden: {
    copy: 'local',
    files: ['features/links/link-list.component.ts'],
  },
  invalid_invite_code: {
    copy: 'local',
    files: ['features/groups/join-group.dialog.ts'],
  },
  group_full: {
    copy: 'local',
    files: ['features/groups/join-group.dialog.ts'],
  },
  too_many_groups: {
    copy: 'local',
    files: [
      'features/groups/create-group.dialog.ts',
      'features/groups/join-group.dialog.ts',
    ],
  },
  owner_cannot_leave: { copy: 'common' },
  already_owner: {
    copy: 'unreachable',
    reason: 'el SPA no ofrece nombrarse propietario a sí mismo',
  },
  sole_owner_with_members: {
    copy: 'local',
    files: ['features/profile/delete-account.dialog.ts'],
  },
  invalid_url: { copy: 'local', files: ['features/links/save-link.form.ts'] },
  text_too_long: {
    copy: 'local',
    files: [
      'features/links/import-links.dialog.ts',
      'features/links/paste-description.dialog.ts',
    ],
  },
  link_not_found: {
    copy: 'local',
    files: [
      'features/links/link-list.component.ts',
      'features/links/my-links.page.ts',
      'features/public/public-preview.page.ts',
    ],
  },
  comment_not_found: { copy: 'local', files: ['core/links/links.store.ts'] },
  preview_field_unknown: {
    copy: 'unreachable',
    reason: 'el editor solo envía campos del schema del preview',
  },
  enrichment_not_retryable: {
    copy: 'local',
    files: ['features/links/link-list.component.ts'],
  },
  not_a_job_posting: {
    copy: 'local',
    files: ['features/links/paste-description.dialog.ts'],
  },
  extraction_unavailable: {
    copy: 'local',
    files: ['features/links/paste-description.dialog.ts'],
  },
  ai_quota_exceeded: {
    copy: 'local',
    files: ['features/links/paste-description.dialog.ts'],
  },
  application_not_found: {
    copy: 'local',
    files: ['core/applications/applications.store.ts'],
  },
  application_conflict: {
    copy: 'local',
    files: ['core/applications/applications.store.ts'],
  },
  cv_not_found: {
    copy: 'local',
    files: ['core/cv/cv.store.ts', 'features/cv/cv-text-preview.dialog.ts'],
  },
  unsupported_file_type: {
    copy: 'local',
    files: ['features/cv/cv-upload.component.ts'],
  },
  file_too_large: {
    copy: 'local',
    files: ['features/cv/cv-upload.component.ts'],
  },
  too_many_cvs: {
    copy: 'local',
    files: ['features/cv/cv-upload.component.ts'],
  },
  analysis_not_found: {
    copy: 'local',
    files: [
      'core/match/match.store.ts',
      'core/roadmap/roadmap.store.ts',
      'features/roadmap/roadmap.page.ts',
    ],
  },
  no_cv: { copy: 'local', files: ['features/match/match.dialog.ts'] },
  cv_not_ready: { copy: 'local', files: ['features/match/match.dialog.ts'] },
  cv_not_readable: { copy: 'local', files: ['features/match/match.dialog.ts'] },
  job_not_ready: { copy: 'local', files: ['features/match/match.dialog.ts'] },
  roadmap_not_eligible: {
    copy: 'local',
    files: ['features/roadmap/roadmap.page.ts'],
  },
  consent_text_outdated: { copy: 'common' },
  vault_unavailable: { copy: 'common' },
  // No hay fichero que compare el literal: `push-notifications.ts` la reconoce por el estado 503 al pedir la clave
  // VAPID y `/notificaciones` pinta el aviso propio (`push-vapid-unavailable`).
  vapid_unavailable: {
    copy: 'local',
    files: ['core/notifications/push-notifications.ts'],
  },
  empty_query: {
    copy: 'unreachable',
    reason: '/buscar no envía una consulta vacía',
  },
  search_unavailable: {
    copy: 'local',
    files: ['features/search/search.page.ts'],
  },
  search_purge_failed: {
    copy: 'fallback',
    reason:
      'pasajero (Meilisearch): el diálogo de borrar cuenta sigue abierto y «en unos minutos» es verdad',
  },
  discovery_disabled: {
    copy: 'local',
    files: ['features/discovery/discovery.page.ts'],
  },
  internal_error: {
    copy: 'fallback',
    reason:
      'es el fallo inesperado: el mensaje por clase con su referencia es el texto correcto',
  },
} as const satisfies Readonly<Record<ApiErrorCode, ApiErrorCopy>>;
