import { GroupNotFound } from '../domain/errors';
import type { Group } from '../domain/group';
import type { Membership } from '../domain/membership';
import type { GroupRepository } from './ports/group-repository.port';

// Resolución de pertenencia (D2 de groups), compartida por todos los casos de uso que reciben un `groupId`.
//
// Un usuario que no es miembro recibe el mismo error que si el grupo no existiera o que si el identificador estuviera
// mal formado (el repositorio devuelve `null` en los tres casos), así que un extraño no puede distinguirlos. Quien sí es
// miembro ya sabe que el grupo existe: a partir de ahí, lo que le falte es un `forbidden`, no un 404.

export interface GroupAccess {
  readonly group: Group;
  readonly membership: Membership;
}

/** Grupo y membresía del usuario, o `GroupNotFound`. Una membresía huérfana también da `GroupNotFound` (D6). */
export async function resolveGroupAccess(
  groups: GroupRepository,
  groupId: string,
  userId: string,
): Promise<GroupAccess> {
  const membership = await groups.findMembership(groupId, userId);
  if (membership === null) {
    throw new GroupNotFound();
  }
  const group = await groups.findById(groupId);
  if (group === null) {
    throw new GroupNotFound();
  }
  return { group, membership };
}
