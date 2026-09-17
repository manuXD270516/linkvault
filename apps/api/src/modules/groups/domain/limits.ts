// Límites antiabuso del módulo `groups` (D4). Se comprueban contando antes de escribir; como no hay transacción entre la
// cuenta y el alta, dos uniones simultáneas pueden dejar un grupo con 51 miembros. Es un límite antiabuso, no una
// invariante de negocio: lo que sí impide el índice único `(groupId, userId)` es una membresía duplicada.

/** Máximo de miembros de un grupo (spec groups/membership). */
export const MAX_MEMBERS_PER_GROUP = 50;

/** Máximo de grupos a los que pertenece un usuario (spec groups/group-management). */
export const MAX_GROUPS_PER_USER = 20;

/** Un grupo que ya tiene el máximo de miembros no admite uno más. */
export function isGroupFull(memberCount: number): boolean {
  return memberCount >= MAX_MEMBERS_PER_GROUP;
}

/**
 * Un usuario que ya está en el máximo de grupos no puede crear ni unirse a otro. Las membresías huérfanas (grupo
 * borrado) no cuentan: quien llama pasa el conteo que descarta esas membresías (D6).
 */
export function hasReachedGroupLimit(groupCount: number): boolean {
  return groupCount >= MAX_GROUPS_PER_USER;
}
