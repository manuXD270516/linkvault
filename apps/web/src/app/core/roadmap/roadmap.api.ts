import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { RoadmapAccepted, RoadmapResponse } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';

/**
 * Llamadas a `/api/analyses/:analysisId/roadmap`. El `Authorization: Bearer` lo pone `authInterceptor`.
 * Tipos solo de `@linkvault/shared`.
 */
@Injectable({ providedIn: 'root' })
export class RoadmapApi {
  private readonly http = inject(HttpClient);

  /**
   * Pide el plan o reutiliza el que ya hay. `202` si el claim gana (`generating`); `200` si ya existía.
   */
  request(analysisId: string): Promise<RoadmapAccepted | RoadmapResponse> {
    return firstValueFrom(
      this.http.post<RoadmapAccepted | RoadmapResponse>(roadmapUrl(analysisId), {}),
    );
  }

  /** Estado actual del roadmap (con ítems solo si `ready`). */
  get(analysisId: string): Promise<RoadmapResponse> {
    return firstValueFrom(this.http.get<RoadmapResponse>(roadmapUrl(analysisId)));
  }

  /** Markdown del plan listo (`text/markdown`). 404 si aún no está `ready`. */
  getMarkdown(analysisId: string): Promise<string> {
    return firstValueFrom(
      this.http.get(markdownUrl(analysisId), { responseType: 'text' }),
    );
  }
}

function roadmapUrl(analysisId: string): string {
  return `/api/analyses/${encodeURIComponent(analysisId)}/roadmap`;
}

function markdownUrl(analysisId: string): string {
  return `/api/analyses/${encodeURIComponent(analysisId)}/roadmap.md`;
}
