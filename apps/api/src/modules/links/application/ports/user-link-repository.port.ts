import type { LinkListPage, LinkListQuery } from './link-listing';
import type { TransactionSession } from './transaction-session';

// Puerto de la lista privada (`user_links`, D1 de job-links): lo que alguien guarda **sin** grupo. Guardar en un grupo NO
// crea entrada privada. Mismas operaciones que la relación con un grupo, con el índice único `(userId, linkId)`.

export const USER_LINK_REPOSITORY = Symbol('USER_LINK_REPOSITORY');

/** Link en la lista privada de una persona. */
export interface UserLink {
  readonly userId: string;
  readonly linkId: string;
  readonly savedAt: Date;
}

/** Entrada tras guardar, y si la creó esta petición o ya estaba. */
export interface SavedUserLink {
  readonly relation: UserLink;
  readonly created: boolean;
}

export interface SaveForUserInput {
  readonly userId: string;
  readonly linkId: string;
  readonly savedAt: Date;
}

export interface UserLinkRepository {
  /** Guarda el link en la lista privada. Idempotente: si ya estaba, `created` es `false` y `savedAt` no cambia. */
  save(
    input: SaveForUserInput,
    session: TransactionSession,
  ): Promise<SavedUserLink>;
  /** Entrada concreta; `null` si el link no está en esa lista o algún id está mal formado. */
  find(userId: string, linkId: string): Promise<UserLink | null>;
  /** Página de la lista privada, por `savedAt` y `_id` descendentes. */
  listByUser(userId: string, query: LinkListQuery): Promise<LinkListPage>;
  /** Cuántos links tiene la lista privada. No depende del tamaño de página. */
  countByUser(userId: string): Promise<number>;
  /** Quita el link de la lista privada; `false` si no estaba. NUNCA borra el `JobLink`. */
  remove(userId: string, linkId: string): Promise<boolean>;
  /** Borra las entradas privadas de un link, de cualquier usuario, y devuelve cuántas. */
  deleteByLink(linkId: string): Promise<number>;
}
