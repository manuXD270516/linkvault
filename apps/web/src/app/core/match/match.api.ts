import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  MatchAnalysisResponse,
  MatchLatest,
  MatchRequestAccepted,
  RequestMatchRequest,
} from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';

const LINKS_URL = '/api/links';

/**
 * Llamadas a `/api/links/:linkId/match`. El `Authorization: Bearer` lo pone `authInterceptor`. Solo importa tipos de
 * `@linkvault/shared`.
 *
 * El `POST` responde `202` al aceptar (o reutilizar un `running`) y `200` cuando reutiliza un informe ya hecho; el
 * cuerpo discrimina: `status: 'running'` frente a `done`/`failed`.
 */
@Injectable({ providedIn: 'root' })
export class MatchApi {
  private readonly http = inject(HttpClient);

  /**
   * Pide un análisis o reutiliza el que ya hay. Con `cvId` se analiza ese CV; sin él, el marcado por defecto.
   */
  request(
    linkId: string,
    cvId?: string,
  ): Promise<MatchRequestAccepted | MatchLatest> {
    const body: RequestMatchRequest = cvId === undefined ? {} : { cvId };
    return firstValueFrom(
      this.http.post<MatchRequestAccepted | MatchLatest>(matchUrl(linkId), body),
    );
  }

  /** Consulta los dos bloques (`latest` y `running`) del análisis de esa oferta. */
  get(linkId: string): Promise<MatchAnalysisResponse> {
    return firstValueFrom(this.http.get<MatchAnalysisResponse>(matchUrl(linkId)));
  }
}

function matchUrl(linkId: string): string {
  return `${LINKS_URL}/${encodeURIComponent(linkId)}/match`;
}
