// Errores de dominio del módulo `groups` (specs groups/group-management y groups/membership). Cada uno lleva el código de
// la API que le corresponde; el filtro de errores de presentación decide el estado HTTP. Nunca llevan códigos de
// invitación, nombres ni emails: pueden acabar en un log.

/** Códigos de `apiErrorCodeSchema` que produce el dominio de `groups` (lo comprueba un test). */
export type GroupsErrorCode =
  | 'group_not_found'
  | 'member_not_found'
  | 'forbidden'
  | 'invalid_invite_code'
  | 'group_full'
  | 'too_many_groups'
  | 'owner_cannot_leave'
  | 'validation_error';

export abstract class GroupsError extends Error {
  abstract readonly code: GroupsErrorCode;
}

/**
 * El grupo no existe, quien pregunta no es miembro o el identificador no tiene el formato de un id de grupo (404). Los
 * tres casos comparten error y cuerpo: un extraño no puede distinguir un grupo ajeno de uno inexistente (D2).
 */
export class GroupNotFound extends GroupsError {
  override readonly name = 'GroupNotFound';
  readonly code = 'group_not_found';

  constructor() {
    super('Group not found');
  }
}

/** El usuario indicado no es miembro del grupo, o su `:userId` no tiene el formato de un id de usuario (404). */
export class MemberNotFound extends GroupsError {
  override readonly name = 'MemberNotFound';
  readonly code = 'member_not_found';

  constructor() {
    super('Member not found');
  }
}

/**
 * Quien pide es miembro del grupo pero la acción es del `owner` (403). Es un error distinto de `GroupNotFound` a
 * propósito: el usuario ya sabe que el grupo existe, así que no hay nada que ocultarle (D2).
 */
export class OwnerRoleRequired extends GroupsError {
  override readonly name = 'OwnerRoleRequired';
  readonly code = 'forbidden';

  constructor() {
    super('Only the group owner can perform this action');
  }
}

/** Código de invitación desconocido o con formato inválido: mismo error y mismo cuerpo en ambos casos (404). */
export class InvalidInviteCode extends GroupsError {
  override readonly name = 'InvalidInviteCode';
  readonly code = 'invalid_invite_code';

  constructor() {
    super('Invalid invite code');
  }
}

/** El grupo ya tiene el máximo de miembros (409). */
export class GroupFull extends GroupsError {
  override readonly name = 'GroupFull';
  readonly code = 'group_full';

  constructor() {
    super('Group is full');
  }
}

/** El usuario ya pertenece al máximo de grupos (409). */
export class TooManyGroups extends GroupsError {
  override readonly name = 'TooManyGroups';
  readonly code = 'too_many_groups';

  constructor() {
    super('Too many groups');
  }
}

/** El owner no puede salir de su grupo ni expulsarse a sí mismo (409): sin transferencia de propiedad, borra el grupo. */
export class OwnerCannotLeave extends GroupsError {
  override readonly name = 'OwnerCannotLeave';
  readonly code = 'owner_cannot_leave';

  constructor() {
    super('The owner cannot leave the group');
  }
}

/**
 * Nombre de grupo vacío o de más de 60 caracteres tras eliminar espacios exteriores (400 nombrando `name`). Defensa en
 * profundidad: el contrato HTTP ya rechaza lo mismo.
 */
export class InvalidGroupName extends GroupsError {
  override readonly name = 'InvalidGroupName';
  readonly code = 'validation_error';
  /** Campo de la petición que nombra la respuesta. */
  readonly field = 'name';

  constructor() {
    super('Invalid group name');
  }
}
