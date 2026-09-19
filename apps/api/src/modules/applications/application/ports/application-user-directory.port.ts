// Puerto hacia `users` (D6 de applications-tracking): los nombres visibles de quienes comparten su estado. El adaptador
// de producción va sobre `UsersFacade.getDisplayNames`, que resuelve todos los ids en una sola consulta. El email nunca
// sale de `users`. Solo tipos y el token.

export const APPLICATION_USER_DIRECTORY = Symbol('APPLICATION_USER_DIRECTORY');

export interface ApplicationUserDirectory {
  /** Nombre visible por id; los ids que no corresponden a ningún usuario quedan fuera del mapa. */
  displayNamesOf(userIds: readonly string[]): Promise<Map<string, string>>;
}
