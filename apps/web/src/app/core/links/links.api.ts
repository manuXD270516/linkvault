import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  EnrichLinkResponse,
  ImportLinksRequest,
  ImportLinksResponse,
  JobLinkSummary,
  LinkPage,
  PastedDescriptionRequest,
  SaveLinkRequest,
  SaveLinkResponse,
  UpdatePreviewRequest,
  UpdatePreviewResponse,
} from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';

const LINKS_URL = '/api/links';
const GROUPS_URL = '/api/groups';

/**
 * Tamaño de página de los listados de links. Repite el valor de `LINK_PAGE_DEFAULT_LIMIT` en lugar de importarlo porque
 * ese módulo de `@linkvault/shared` arrastra zod, que solo puede entrar en chunks lazy y no en el bundle inicial
 * (presupuesto de 500 kB), igual que en `core/groups/groups.api.ts`.
 */
export const LINKS_PAGE_SIZE = 20;

/** Página pedida a la API: sin `cursor` es la primera. */
export interface LinksPageQuery {
  limit?: number;
  cursor?: string;
}

/**
 * Llamadas a `/api/links` y a los links de un grupo. El `Authorization: Bearer` lo pone `authInterceptor` (ninguna de
 * estas peticiones marca `SKIP_BEARER`), que también renueva la sesión ante un `401`. Solo importa tipos de
 * `@linkvault/shared`.
 */
@Injectable({ providedIn: 'root' })
export class LinksApi {
  private readonly http = inject(HttpClient);

  /** Guarda una URL; sin `groupId` el link queda solo en la lista privada de quien lo guarda. */
  saveLink(url: string, groupId?: string): Promise<SaveLinkResponse> {
    const body: SaveLinkRequest = groupId === undefined ? { url } : { url, groupId };
    return firstValueFrom(this.http.post<SaveLinkResponse>(LINKS_URL, body));
  }

  /** Importa el texto pegado; la API extrae las URLs y nunca guarda el texto. */
  importLinks(text: string, groupId?: string): Promise<ImportLinksResponse> {
    const body: ImportLinksRequest = groupId === undefined ? { text } : { text, groupId };
    return firstValueFrom(this.http.post<ImportLinksResponse>(`${LINKS_URL}/import`, body));
  }

  listGroupLinks(groupId: string, query: LinksPageQuery = {}): Promise<LinkPage> {
    return firstValueFrom(
      this.http.get<LinkPage>(`${groupLinksUrl(groupId)}`, { params: pageParams(query) }),
    );
  }

  listMyLinks(query: LinksPageQuery = {}): Promise<LinkPage> {
    return firstValueFrom(
      this.http.get<LinkPage>(`${LINKS_URL}/mine`, { params: pageParams(query) }),
    );
  }

  /**
   * Corrige a mano los campos del preview y devuelve el link ya actualizado, para que la tarjeta se reemplace sin
   * volver a pedir la lista. `revert` son los campos que vuelven a lo que se extrajo de la página.
   */
  updatePreview(linkId: string, body: UpdatePreviewRequest): Promise<UpdatePreviewResponse> {
    return firstValueFrom(
      this.http.patch<UpdatePreviewResponse>(`${LINKS_URL}/${encodeURIComponent(linkId)}/preview`, body),
    );
  }

  /**
   * Completa la oferta con el texto que pegó la persona y devuelve el link ya actualizado. La API lo lee dentro de la
   * misma petición y no lo guarda; aquí tampoco se guarda en ningún sitio: viaja en el cuerpo y nada más.
   */
  pasteDescription(linkId: string, body: PastedDescriptionRequest): Promise<JobLinkSummary> {
    return firstValueFrom(
      this.http.post<JobLinkSummary>(`${LINKS_URL}/${encodeURIComponent(linkId)}/pasted`, body),
    );
  }

  /** Vuelve a pedir la lectura de una oferta que falló por algo pasajero; responde con el link de vuelta en `pending`. */
  enrich(linkId: string): Promise<EnrichLinkResponse> {
    return firstValueFrom(
      this.http.post<EnrichLinkResponse>(`${LINKS_URL}/${encodeURIComponent(linkId)}/enrich`, {}),
    );
  }

  /** Quita la relación del link con el grupo; la vacante sigue viva en los demás grupos y listas. */
  async removeGroupLink(groupId: string, linkId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<null>(`${groupLinksUrl(groupId)}/${encodeURIComponent(linkId)}`),
    );
  }

  async removeMyLink(linkId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<null>(`${LINKS_URL}/mine/${encodeURIComponent(linkId)}`),
    );
  }
}

/** El `cursor` es opaco: viaja tal cual y solo cuando lo hay, para que la primera página no lo lleve vacío. */
function pageParams({ limit = LINKS_PAGE_SIZE, cursor }: LinksPageQuery): HttpParams {
  const params = new HttpParams().set('limit', limit);
  return cursor === undefined ? params : params.set('cursor', cursor);
}

function groupLinksUrl(groupId: string): string {
  return `${GROUPS_URL}/${encodeURIComponent(groupId)}/links`;
}
