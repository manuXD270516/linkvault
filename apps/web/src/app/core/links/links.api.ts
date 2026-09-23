import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  CommentPage,
  CreateCommentRequest,
  CreateCommentResponse,
  DeleteCommentResponse,
  EnrichLinkResponse,
  ImportLinksRequest,
  ImportLinksResponse,
  JobLinkSummary,
  KnowSomeoneState,
  LinkPage,
  PastedDescriptionRequest,
  PublicShare,
  ReopenLinkRequest,
  ReopenLinkResponse,
  SaveLinkRequest,
  SaveLinkResponse,
  SetKnowSomeoneRequest,
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

  /**
   * Guarda una URL; sin `groupId` el link queda solo en la lista privada de quien lo guarda. `note` es la nota para el
   * grupo (D3 de group-comments): solo viaja con grupo y con texto, porque una nota vacía equivale a no enviarla.
   */
  saveLink(url: string, groupId?: string, note?: string): Promise<SaveLinkResponse> {
    const body: SaveLinkRequest = groupId === undefined ? { url } : { url, groupId };
    if (groupId !== undefined && note !== undefined && note.trim().length > 0) {
      body.note = note;
    }
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

  /**
   * Reabre una vacante cerrada por frescura (ADR-041). Body opcional: `expiresAt` date-only o `null` para quitar
   * caducidad. Responde el summary ya abierto (sin `closedAt`).
   */
  reopen(linkId: string, body: ReopenLinkRequest = {}): Promise<ReopenLinkResponse> {
    return firstValueFrom(
      this.http.post<ReopenLinkResponse>(
        `${LINKS_URL}/${encodeURIComponent(linkId)}/reopen`,
        body,
      ),
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

  /** Una página del hilo de un link en un grupo, del más reciente al más antiguo (D7 de group-comments). */
  comments(groupId: string, linkId: string, query: LinksPageQuery = {}): Promise<CommentPage> {
    return firstValueFrom(
      this.http.get<CommentPage>(commentsUrl(groupId, linkId), { params: pageParams(query) }),
    );
  }

  /** Publica un comentario; responde con él y con el resumen de la tarjeta ya actualizado. */
  postComment(groupId: string, linkId: string, text: string): Promise<CreateCommentResponse> {
    const body: CreateCommentRequest = { text };
    return firstValueFrom(this.http.post<CreateCommentResponse>(commentsUrl(groupId, linkId), body));
  }

  /** Borra un comentario; responde `200 { comments }` con el resumen nuevo, la misma forma que el alta. */
  deleteComment(groupId: string, linkId: string, commentId: string): Promise<DeleteCommentResponse> {
    return firstValueFrom(
      this.http.delete<DeleteCommentResponse>(
        `${commentsUrl(groupId, linkId)}/${encodeURIComponent(commentId)}`,
      ),
    );
  }

  /**
   * Enciende el enlace público de un link del grupo y responde con él ya compuesto (D2 de public-preview-share). Es
   * idempotente: un link ya publicado responde el mismo enlace, sin crear otro.
   */
  publishGroupLink(groupId: string, linkId: string): Promise<PublicShare> {
    return firstValueFrom(
      this.http.put<PublicShare>(publicShareUrl(groupId, linkId), null),
    );
  }

  /** Apaga el enlace público (`204`): el `slug` se quema y volver a publicar creará uno nuevo. */
  async unpublishGroupLink(groupId: string, linkId: string): Promise<void> {
    await firstValueFrom(this.http.delete<null>(publicShareUrl(groupId, linkId)));
  }

  /** Quita la nota de quien compartió el link (`204`); no hay forma de editarla. */
  async removeNote(groupId: string, linkId: string): Promise<void> {
    await firstValueFrom(
      this.http.delete<null>(`${groupLinksUrl(groupId)}/${encodeURIComponent(linkId)}/note`),
    );
  }

  /**
   * Marca o desmarca «conozco a alguien ahí» y responde el estado slim (D2 de know-someone-flag) para merge local sin
   * perder note/comments/publicShare.
   */
  setKnowSomeone(
    groupId: string,
    linkId: string,
    body: SetKnowSomeoneRequest,
  ): Promise<KnowSomeoneState> {
    return firstValueFrom(
      this.http.put<KnowSomeoneState>(knowSomeoneUrl(groupId, linkId), body),
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

function commentsUrl(groupId: string, linkId: string): string {
  return `${groupLinksUrl(groupId)}/${encodeURIComponent(linkId)}/comments`;
}

function publicShareUrl(groupId: string, linkId: string): string {
  return `${groupLinksUrl(groupId)}/${encodeURIComponent(linkId)}/public`;
}

function knowSomeoneUrl(groupId: string, linkId: string): string {
  return `${groupLinksUrl(groupId)}/${encodeURIComponent(linkId)}/know-someone`;
}
