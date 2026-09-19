import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  Application,
  ApplicationListResponse,
  ApplicationTimelineResponse,
  ChangeApplicationStatusRequest,
  GroupTrackersResponse,
  TrackLinkRequest,
  TrackLinkResponse,
  UpdateApplicationRequest,
} from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';

const APPLICATIONS_URL = '/api/applications';
const GROUPS_URL = '/api/groups';

/**
 * Máximo de `linkIds` por petición. Repite `APPLICATION_LINK_IDS_MAX` en lugar de importarlo por la misma razón que
 * `LINKS_PAGE_SIZE`: el módulo de `@linkvault/shared` que lo define arrastra zod, y `core/` solo importa tipos.
 */
export const APPLICATION_LINK_IDS_PER_REQUEST = 50;

/**
 * Llamadas a `/api/applications` y a los estados compartidos de un grupo (D11 de applications-tracking). El `Bearer` lo
 * pone `authInterceptor`. Solo importa tipos de `@linkvault/shared`.
 */
@Injectable({ providedIn: 'root' })
export class ApplicationsApi {
  private readonly http = inject(HttpClient);

  /** Sin `linkIds`, todas las postulaciones propias (tablero); con ellos, solo las de esos links (hasta 50). */
  async list(linkIds?: readonly string[]): Promise<Application[]> {
    const params =
      linkIds === undefined ? undefined : new HttpParams().set('linkIds', linkIds.join(','));
    const response = await firstValueFrom(
      this.http.get<ApplicationListResponse>(APPLICATIONS_URL, { params }),
    );
    return response.items;
  }

  /** Empieza a seguir un link; si ya se seguía, la API devuelve la existente con `created: false`. */
  track(body: TrackLinkRequest): Promise<TrackLinkResponse> {
    return firstValueFrom(this.http.post<TrackLinkResponse>(APPLICATIONS_URL, body));
  }

  changeStatus(applicationId: string, body: ChangeApplicationStatusRequest): Promise<Application> {
    return firstValueFrom(
      this.http.patch<Application>(`${applicationUrl(applicationId)}/status`, body),
    );
  }

  /** Notas y visibilidad: última escritura gana, sin `version`. */
  update(applicationId: string, body: UpdateApplicationRequest): Promise<Application> {
    return firstValueFrom(this.http.patch<Application>(applicationUrl(applicationId), body));
  }

  async untrack(applicationId: string): Promise<void> {
    await firstValueFrom(this.http.delete<null>(applicationUrl(applicationId)));
  }

  async timeline(applicationId: string): Promise<ApplicationTimelineResponse['items']> {
    const response = await firstValueFrom(
      this.http.get<ApplicationTimelineResponse>(`${applicationUrl(applicationId)}/events`),
    );
    return response.items;
  }

  /** Quién comparte su estado sobre cada uno de esos links (hasta 50) en el grupo. */
  async groupTrackers(
    groupId: string,
    linkIds: readonly string[],
  ): Promise<GroupTrackersResponse['items']> {
    const response = await firstValueFrom(
      this.http.get<GroupTrackersResponse>(
        `${GROUPS_URL}/${encodeURIComponent(groupId)}/applications`,
        { params: new HttpParams().set('linkIds', linkIds.join(',')) },
      ),
    );
    return response.items;
  }
}

function applicationUrl(applicationId: string): string {
  return `${APPLICATIONS_URL}/${encodeURIComponent(applicationId)}`;
}

/** Parte una lista de identificadores en bloques de hasta `size`, en el mismo orden. */
export function chunksOf<T>(items: readonly T[], size: number = APPLICATION_LINK_IDS_PER_REQUEST): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}
