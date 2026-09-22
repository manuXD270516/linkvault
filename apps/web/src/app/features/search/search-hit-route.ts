import type { SearchHit } from '@linkvault/shared';

/**
 * Ruta SPA del recurso al que apunta un hit. `null` si faltan ids de navegación (no debería pasar
 * con un índice sano; la UI omitiría el enlace).
 */
export function searchHitRoute(hit: SearchHit): string | null {
  switch (hit.docType) {
    case 'job_preview':
      return hit.groupId !== undefined ? `/grupos/${hit.groupId}` : '/mis-links';
    case 'application':
      return '/postulaciones';
    case 'group_comment':
    case 'group_link_note':
      return hit.groupId !== undefined ? `/grupos/${hit.groupId}` : null;
    case 'cv':
      return '/mi-cv';
    case 'roadmap':
      return hit.analysisId !== undefined ? `/plan/${hit.analysisId}` : null;
  }
}
