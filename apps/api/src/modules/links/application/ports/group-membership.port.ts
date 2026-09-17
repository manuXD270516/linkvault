import type { GroupRole } from '@linkvault/shared';

// Puerto de pertenencia a grupos (D1 de job-links). `links` NO lee las colecciones de `groups`: el adaptador de
// producción va sobre `GroupsFacade`, su única entrada pública. El nombre es distinto del `GROUP_MEMBER_DIRECTORY` de
// `groups`, que significa lo contrario (nombres de los miembros).

export const GROUP_MEMBERSHIP = Symbol('GROUP_MEMBERSHIP');

/** Grupo del usuario con lo que `links` necesita: identificarlo, nombrarlo en `alreadyInGroups` y juzgar el rol. */
export interface UserGroup {
  readonly groupId: string;
  readonly name: string;
  readonly role: GroupRole;
}

export interface GroupMembership {
  /**
   * Rol del usuario en el grupo, o `null` si no es miembro, el grupo no existe o el identificador está mal formado: los
   * tres casos son el mismo 404 para quien pregunta.
   */
  membershipOf(groupId: string, userId: string): Promise<GroupRole | null>;
  /** Grupos del usuario, del más reciente al más antiguo. Una sola llamada por petición (D4). */
  groupsOf(userId: string): Promise<UserGroup[]>;
}
