export const SEARCH_MEMBERSHIP = Symbol('SEARCH_MEMBERSHIP');

/** Grupos del usuario autenticado (para ACL de búsqueda). */
export interface SearchMembership {
  groupIdsOf(userId: string): Promise<readonly string[]>;
}
