import type { GroupRole, GroupVisibility } from '@linkvault/shared';

// Puerto de pertenencia a grupos (D1 de job-links). `links` NO lee las colecciones de `groups`: el adaptador de
// producción va sobre `GroupsFacade`, su única entrada pública. El nombre es distinto del `GROUP_MEMBER_DIRECTORY` de
// `groups`, que significa lo contrario (nombres de los miembros).

export const GROUP_MEMBERSHIP = Symbol('GROUP_MEMBERSHIP');

/**
 * Grupo del usuario con lo que `links` necesita: identificarlo, nombrarlo en `alreadyInGroups`, juzgar el rol y saber
 * si un link que entra nace publicado (D3 de public-preview-share).
 */
export interface UserGroup {
  readonly groupId: string;
  readonly name: string;
  readonly role: GroupRole;
  /**
   * Visibilidad por defecto del grupo. Llega en la misma lectura que la pertenencia, así que guardar o importar no
   * cuestan ninguna consulta más por saberlo.
   */
  readonly defaultVisibility: GroupVisibility;
}

export interface GroupMembership {
  /**
   * Rol del usuario en el grupo, o `null` si no es miembro, el grupo no existe o el identificador está mal formado: los
   * tres casos son el mismo 404 para quien pregunta.
   */
  membershipOf(groupId: string, userId: string): Promise<GroupRole | null>;
  /** Grupos del usuario, del más reciente al más antiguo. Una sola llamada por petición (D4). */
  groupsOf(userId: string): Promise<UserGroup[]>;
  /**
   * Quiénes son miembros de esos grupos, sin repetir. Lo usa el reparto de un aviso para saber a quién avisar de un
   * link compartido; un grupo que no existe simplemente no aporta a nadie.
   */
  memberIdsOf(groupIds: readonly string[]): Promise<string[]>;
  /**
   * De los candidatos, los que comparten al menos un grupo con `userId` (cualquiera, no necesariamente el del link). Una
   * sola consulta por llamada. Un fallo se propaga: quien llama no tiene un respaldo que muestre más de lo debido.
   */
  peersAmong(
    userId: string,
    candidateIds: readonly string[],
  ): Promise<Set<string>>;
}
