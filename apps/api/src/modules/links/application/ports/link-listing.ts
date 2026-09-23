import type { JobLink } from '../../domain/job-link';
import type { PublicShare } from '../../domain/public-share';

// Forma común de los dos listados paginados (D8 de job-links): los links de un grupo y la lista privada. El orden es por
// fecha y, a igualdad, por el `_id` de la relación, ambos descendentes; sin ese desempate, importar 50 links en el mismo
// instante haría que la paginación repitiera u omitiera filas.

/** Posición exacta dentro de un listado. El cursor opaco que viaja por HTTP es su codificación. */
export interface LinkCursor {
  /** `sharedAt` en un grupo, `savedAt` en la lista privada. */
  readonly date: Date;
  /** `_id` de la relación, no del link. */
  readonly relationId: string;
}

export interface LinkListQuery {
  /** Cuántas filas como máximo; lo acota el contrato HTTP (1..50). */
  readonly limit: number;
  /** Desde dónde seguir; ausente en la primera página. */
  readonly cursor?: LinkCursor;
  /**
   * Filtros solo del listado de un grupo (D5 de group-link-tags-pinned). La lista privada no los usa.
   * `tag` llega ya normalizado desde el schema HTTP.
   */
  readonly pinned?: boolean;
  readonly tag?: string;
}

/** Fila de un listado: el link y cómo llegó a esa lista. */
export interface ListedLink {
  readonly relationId: string;
  readonly link: JobLink;
  /** Quién lo compartió. Ausente en la lista privada: allí no hay con quién compartir. */
  readonly sharedBy?: string;
  readonly sharedAt: Date;
  /**
   * Nota y contadores de comentarios de la relación (D7 de group-comments). Solo en el listado de un grupo: la lista
   * privada no tiene nota ni comentarios.
   */
  readonly inGroup?: ListedGroupRelation;
}

/** Lo que una relación de grupo aporta a su fila del listado. */
export interface ListedGroupRelation {
  readonly note?: { readonly text: string; readonly createdAt: Date };
  readonly commentCount: number;
  readonly commentsRevision: number;
  /**
   * Enlace público de la relación, si lo tiene (D1 de public-preview-share). Viaja en la **misma** consulta que la
   * nota y los contadores: pintar el interruptor no cuesta ninguna lectura más.
   */
  readonly publicShare?: PublicShare;
  /**
   * UserIds que marcaron know-someone (D3 de know-someone-flag). Viaja en la misma consulta; el listado proyecta
   * `count` y `flaggedByMe` sin exponer los ids.
   */
  readonly knowSomeoneUserIds: readonly string[];
  /**
   * Tags y pinned de la relación (D4 de group-link-tags-pinned). Viajan en la misma consulta; defaults de lectura
   * `[]` / `false` si el documento no los tiene.
   */
  readonly tags: readonly string[];
  readonly pinned: boolean;
}

/** Página de un listado. `nextCursor` solo viaja cuando hay más filas detrás. */
export interface LinkListPage {
  readonly items: readonly ListedLink[];
  readonly nextCursor?: LinkCursor;
}
