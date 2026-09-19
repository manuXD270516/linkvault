// Puerto hacia `groups` (D1 y D6 de applications-tracking). El adaptador de producción va sobre `GroupsFacade`. Solo
// tipos y el token.

export const APPLICATION_GROUPS = Symbol('APPLICATION_GROUPS');

export interface ApplicationGroups {
  /**
   * Miembros actuales del grupo, en una sola consulta. Dice a la vez quién puede ver los estados compartidos y si quien
   * pide es miembro: un grupo que no existe, borrado o con el id mal formado devuelve una lista vacía (D6).
   */
  memberIdsOf(groupId: string): Promise<string[]>;
}
