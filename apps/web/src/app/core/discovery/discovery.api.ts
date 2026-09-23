import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { DiscoveryBoard, DiscoverySearchResponse } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';

const DISCOVERY_SEARCH_URL = '/api/discovery/search';

/**
 * Cap por board (y default) alineado a `DISCOVERY_PAGE_SIZE_DEFAULT` de shared. Se repite aquí para no
 * arrastrar zod al bundle inicial de `core/`.
 */
export const DISCOVERY_PAGE_SIZE = 10;

/** Parámetros que envía la SPA a `GET /api/discovery/search` (D2 / ADR-043). */
export interface DiscoverySearchRequest {
  q: string;
  board: DiscoveryBoard;
  page?: number;
  pageSize?: number;
}

/**
 * Cliente de discovery. El Bearer lo pone `authInterceptor`. Solo importa tipos de
 * `@linkvault/shared`.
 */
@Injectable({ providedIn: 'root' })
export class DiscoveryApi {
  private readonly http = inject(HttpClient);

  search(request: DiscoverySearchRequest): Promise<DiscoverySearchResponse> {
    const params = new HttpParams()
      .set('q', request.q)
      .set('board', request.board)
      .set('page', String(request.page ?? 1))
      .set('pageSize', String(request.pageSize ?? DISCOVERY_PAGE_SIZE));
    return firstValueFrom(
      this.http.get<DiscoverySearchResponse>(DISCOVERY_SEARCH_URL, { params }),
    );
  }
}
