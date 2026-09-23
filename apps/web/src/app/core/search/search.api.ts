import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { SearchQueryParams, SearchResponse } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';

const SEARCH_URL = '/api/search';

/**
 * Límite por defecto de hits. Repite `SEARCH_LIMIT_DEFAULT` de shared en lugar de importarlo: el módulo de
 * `@linkvault/shared` que lo define arrastra zod, y `core/` solo importa tipos.
 */
export const SEARCH_PAGE_SIZE = 20;

/**
 * Parámetros que envía la SPA V0. **Sin** `mode`: la API usa hybrid por defecto (D8 / S13).
 * Filtros: `docType`, `groupId`, LatAm `modality` / `applicationStatus` / `salaryCurrency`, y `openOnly` (D3).
 */
export type SearchRequest = Pick<
  SearchQueryParams,
  | 'q'
  | 'docType'
  | 'groupId'
  | 'limit'
  | 'offset'
  | 'modality'
  | 'applicationStatus'
  | 'salaryCurrency'
  | 'openOnly'
>;

/**
 * Llamadas a `GET /api/search`. El Bearer lo pone `authInterceptor`. Solo importa tipos de
 * `@linkvault/shared`.
 */
@Injectable({ providedIn: 'root' })
export class SearchApi {
  private readonly http = inject(HttpClient);

  search(request: SearchRequest): Promise<SearchResponse> {
    let params = new HttpParams().set('q', request.q);
    if (request.docType !== undefined) {
      params = params.set('docType', request.docType);
    }
    if (request.groupId !== undefined) {
      params = params.set('groupId', request.groupId);
    }
    if (request.modality !== undefined) {
      params = params.set('modality', request.modality);
    }
    if (request.applicationStatus !== undefined) {
      params = params.set('applicationStatus', request.applicationStatus);
    }
    if (request.salaryCurrency !== undefined) {
      params = params.set('salaryCurrency', request.salaryCurrency);
    }
    if (request.openOnly !== undefined) {
      // Querystring: boolean tipado → "true"|"false" (API no usa coerce.boolean).
      params = params.set('openOnly', request.openOnly ? 'true' : 'false');
    }
    params = params.set('limit', String(request.limit ?? SEARCH_PAGE_SIZE));
    if (request.offset !== undefined) {
      params = params.set('offset', String(request.offset));
    }
    return firstValueFrom(this.http.get<SearchResponse>(SEARCH_URL, { params }));
  }
}
