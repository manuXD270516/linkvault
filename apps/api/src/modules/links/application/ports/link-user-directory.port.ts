// Puerto de nombres visibles de quien compartió un link (D1 de job-links). `links` NO lee la colección `users`: el
// adaptador de producción va sobre `UsersFacade.getDisplayNames`. Solo nombres visibles; el email nunca sale de `users`.

export const LINK_USER_DIRECTORY = Symbol('LINK_USER_DIRECTORY');

export interface LinkUserDirectory {
  /**
   * Nombre visible de cada id conocido, en una sola consulta. Un id sin entrada no aparece en el mapa: el mapeo lo
   * resuelve como "Usuario", de forma defensiva.
   */
  displayNamesOf(userIds: readonly string[]): Promise<Map<string, string>>;
}
