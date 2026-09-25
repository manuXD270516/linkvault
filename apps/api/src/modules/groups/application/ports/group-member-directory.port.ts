// Puerto de nombres visibles de los miembros (D7 de groups). `groups` NO lee la colección `users`: el adaptador de
// producción va sobre `UsersFacade`. Solo nombres visibles; el email nunca sale de `users`.

export const GROUP_MEMBER_DIRECTORY = Symbol('GROUP_MEMBER_DIRECTORY');

export interface GroupMemberDirectory {
  /**
   * Nombre visible de cada id conocido, en una sola consulta. Un id sin entrada no aparece en el mapa: el mapeo lo
   * resuelve como "Usuario", de forma defensiva. La cascada de `DELETE /api/users/me` borra las membresías de quien
   * se va, así que no debería haber huecos; la defensa se queda por si los hubiera.
   */
  displayNamesOf(userIds: readonly string[]): Promise<Map<string, string>>;
}
