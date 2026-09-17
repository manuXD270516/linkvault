import type { GroupDetail, GroupMember, GroupSummary } from '@linkvault/shared';
import type { Group } from '../domain/group';
import { isOwner, type GroupRole, type Membership } from '../domain/membership';

// Mapeo único a los contratos de la API (D2 de groups). Que el código de invitación salga o no se decide aquí y en
// ningún otro sitio: `toGroupSummary` no lo lleva nunca, y `toGroupDetail` solo si quien pregunta es el `owner` y el
// endpoint lo pide. Así ningún caso de uso puede filtrarlo por descuido.

/** Grupo en la lista del usuario y en la respuesta de unión. Nunca lleva el código, tampoco para el owner. */
export function toGroupSummary(
  group: Group,
  role: GroupRole,
  memberCount: number,
  joinedAt: Date,
): GroupSummary {
  return {
    id: group.id,
    name: group.name,
    role,
    memberCount,
    joinedAt: joinedAt.toISOString(),
  };
}

/**
 * Detalle de un grupo. `includeInviteCode` es la intención del endpoint; el rol es la última palabra: un miembro que no
 * es owner nunca recibe el código aunque quien llame lo pida.
 */
export function toGroupDetail(
  group: Group,
  role: GroupRole,
  memberCount: number,
  options: { includeInviteCode: boolean },
): GroupDetail {
  const detail: GroupDetail = {
    id: group.id,
    name: group.name,
    role,
    memberCount,
    createdAt: group.createdAt.toISOString(),
  };
  return options.includeInviteCode && isOwner(role)
    ? { ...detail, inviteCode: group.inviteCode }
    : detail;
}

/**
 * Nombre que se muestra cuando el directorio no conoce al usuario (D7). Defensa en profundidad: hoy no existe el borrado
 * de cuenta, así que no debería ocurrir.
 */
export const UNKNOWN_MEMBER_NAME = 'Usuario';

/** Miembro de la lista del grupo. Lista cerrada de campos: el email nunca sale de `users`. */
export function toGroupMember(
  membership: Membership,
  displayName: string | undefined,
): GroupMember {
  return {
    userId: membership.userId,
    displayName: displayName ?? UNKNOWN_MEMBER_NAME,
    role: membership.role,
    joinedAt: membership.joinedAt.toISOString(),
  };
}
