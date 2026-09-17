// Membresía y roles (D1 y D2 de groups). La membresía es la única fuente de la propiedad del grupo: cada grupo tiene
// exactamente una con rol `owner`, y ninguna operación puede borrarla (ni salir ni expulsar), porque hoy no existe la
// transferencia de propiedad: el owner que quiere irse borra el grupo.

/** Roles dentro de un grupo. Mismo conjunto que `groupRoleSchema` de `@linkvault/shared` (lo comprueba un test). */
export const GROUP_ROLES = ['owner', 'member'] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

export interface Membership {
  readonly groupId: string;
  readonly userId: string;
  readonly role: GroupRole;
  readonly joinedAt: Date;
}

export function isOwner(role: GroupRole): boolean {
  return role === 'owner';
}

/** Renombrar el grupo es del owner; un miembro recibe `Forbidden` (spec groups/group-management). */
export function canRenameGroup(role: GroupRole): boolean {
  return isOwner(role);
}

/** Regenerar el código de invitación es del owner. */
export function canRotateInviteCode(role: GroupRole): boolean {
  return isOwner(role);
}

/** Borrar el grupo es del owner. */
export function canDeleteGroup(role: GroupRole): boolean {
  return isOwner(role);
}

/** Expulsar a otro miembro es del owner. */
export function canRemoveMembers(role: GroupRole): boolean {
  return isOwner(role);
}

/** El owner NO puede salir de su grupo: recibe `OwnerCannotLeave` y sigue siendo miembro (spec groups/membership). */
export function canLeaveGroup(role: GroupRole): boolean {
  return !isOwner(role);
}

/** La membresía `owner` nunca se elimina, tampoco si el owner se expulsa a sí mismo. */
export function canBeRemoved(role: GroupRole): boolean {
  return !isOwner(role);
}

/** Alta de una membresía. `joinedAt` ordena la lista de miembros y la lista de grupos del usuario. */
export function createMembership(params: {
  groupId: string;
  userId: string;
  role: GroupRole;
  now: Date;
}): Membership {
  return {
    groupId: params.groupId,
    userId: params.userId,
    role: params.role,
    joinedAt: params.now,
  };
}
