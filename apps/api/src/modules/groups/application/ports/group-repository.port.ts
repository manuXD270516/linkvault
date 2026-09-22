import type { Group, GroupVisibility } from '../../domain/group';
import type { GroupRole, Membership } from '../../domain/membership';

// Puerto de persistencia de grupos y membresías (D1 de groups). Se inyecta con
// `{ provide: GROUP_REPOSITORY, useClass: MongoGroupRepository }`. Solo tipos y el token.
//
// Ningún método lanza por un identificador mal formado: devuelven `null`, un resultado negativo o una lista vacía (D2), y
// el caso de uso los convierte en el 404 uniforme. El repositorio no decide quién puede hacer qué (eso es del dominio),
// pero las escrituras que dependen del rol lo **condicionan al escribir** (transferir, salir, expulsar y borrar,
// ADR-025 §3): así, un rol que cambió entre la lectura del caso de uso y la escritura no se pisa.

export const GROUP_REPOSITORY = Symbol('GROUP_REPOSITORY');

/** Grupo del usuario junto con su membresía. Las membresías huérfanas (grupo ya borrado) no se devuelven (D6). */
export interface UserGroup {
  readonly group: Group;
  readonly role: GroupRole;
  readonly joinedAt: Date;
}

export interface CreateGroupInput {
  /** Nombre ya normalizado y validado por el caso de uso. */
  readonly name: string;
  /** Usuario que queda como `owner`; su membresía se escribe en la misma transacción. */
  readonly ownerId: string;
  readonly now: Date;
}

export interface AddMemberInput {
  readonly groupId: string;
  readonly userId: string;
  readonly now: Date;
}

/**
 * Resultado de `transferOwnership`: `not_owner` si quien transfiere ya no es owner al escribir, `target_not_member` si el
 * elegido no es `member` del grupo (no existe, es otro grupo o su id está mal formado). En ambos casos no cambia nada.
 */
export type TransferOwnershipResult =
  'transferred' | 'not_owner' | 'target_not_member';

/**
 * Resultado de `removeMember`: `now_owner` si la membresía existe pero es `owner` al escribir (acaba de recibir la
 * propiedad) y no se borra; `not_member` si no existe o algún id está mal formado.
 */
export type RemoveMemberResult = 'removed' | 'now_owner' | 'not_member';

/**
 * Resultado de `deleteGroup`: `not_owner` si el grupo existe pero quien pide no es su owner al escribir, y no se borra
 * nada; `not_found` si el grupo no existe o el id está mal formado.
 */
export type DeleteGroupResult = 'deleted' | 'not_found' | 'not_owner';

export interface GroupRepository {
  /**
   * Crea el grupo y la membresía `owner` en una transacción: nunca queda un grupo sin owner con un código válido (D6).
   * El código de invitación lo pide al generador y reintenta ante una colisión del índice único (D3).
   */
  create(input: CreateGroupInput): Promise<Group>;
  /** `null` también si el id no tiene el formato de un id de grupo. */
  findById(groupId: string): Promise<Group | null>;
  /** `inviteCode` ya normalizado y con el formato comprobado por el dominio. */
  findByInviteCode(inviteCode: string): Promise<Group | null>;
  /** Membresía del usuario en el grupo; `null` si no es miembro o si algún id está mal formado. */
  findMembership(groupId: string, userId: string): Promise<Membership | null>;
  /** Grupos del usuario con su membresía, por `joinedAt` descendente y sin huérfanas. */
  listGroupsOfUser(userId: string): Promise<UserGroup[]>;
  /** Cuántos grupos cuentan para el límite del usuario: la misma consulta que `listGroupsOfUser` (D4 y D6). */
  countGroupsOfUser(userId: string): Promise<number>;
  /** Miembros del grupo por `joinedAt` ascendente (el owner primero por antigüedad). */
  listMembers(groupId: string): Promise<Membership[]>;
  /**
   * Miembros de varios grupos con una sola agregación. Un grupo sin miembros no aparece en el mapa; quien llama usa 0.
   */
  countMembers(groupIds: readonly string[]): Promise<Map<string, number>>;
  /**
   * Añade al usuario como `member`. Idempotente: si ya era miembro (o si dos peticiones coinciden y el índice único
   * rechaza la segunda) devuelve la membresía existente sin crear una segunda (D5).
   */
  addMember(input: AddMemberInput): Promise<Membership>;
  /**
   * Hace owner a `toUserId` y member a `fromUserId` en una transacción, cada escritura condicionada por rol: degradar
   * primero y promover después (ADR-025 §1 y §2). O se confirman las dos o ninguna; `joinedAt` no cambia.
   */
  transferOwnership(
    groupId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<TransferOwnershipResult>;
  /**
   * Borra la membresía solo si es `member` (ADR-025 §3). No exige que el grupo exista, para que una membresía huérfana
   * se pueda soltar y libere la plaza (D6). Quién puede salir o ser expulsado lo decide el caso de uso con el dominio.
   */
  removeMember(groupId: string, userId: string): Promise<RemoveMemberResult>;
  /** Grupo renombrado; `null` si no existe o el id está mal formado. */
  rename(groupId: string, name: string, now: Date): Promise<Group | null>;
  /**
   * Grupo con otra visibilidad por defecto (D3 de public-preview-share); `null` si no existe o el id está mal formado.
   * Escribe **solo** el documento del grupo: cambiar el ajuste no publica ni despublica ningún link ya compartido.
   */
  updateSettings(
    groupId: string,
    defaultVisibility: GroupVisibility,
    now: Date,
  ): Promise<Group | null>;
  /** Grupo con un código nuevo, con el mismo reintento que `create`; `null` si no existe. */
  rotateInviteCode(groupId: string, now: Date): Promise<Group | null>;
  /**
   * Borra el grupo, todas sus membresías y lo que cuelga de él en una transacción, solo si `ownerId` es su owner en el
   * momento de escribir (ADR-025 §3).
   */
  deleteGroup(groupId: string, ownerId: string): Promise<DeleteGroupResult>;
  /**
   * Misma cascada que `deleteGroup`, pero dentro de una sesión ya abierta (borrado de cuenta, D11 / ADR-033). Quien
   * llama es dueño del commit; si este método falla, la txn entera se deshace.
   */
  deleteGroupInSession(
    groupId: string,
    ownerId: string,
    session: object,
  ): Promise<DeleteGroupResult>;
  /**
   * Borra la membresía del usuario en el grupo dentro de una sesión ya abierta (borrado de cuenta). No exige rol
   * `member`: al borrar la cuenta también se suelta una membresía `owner` de un grupo que se acaba de vaciar por otro
   * camino; en la práctica el caso de uso solo llama esto para roles `member`.
   */
  removeMembershipInSession(
    groupId: string,
    userId: string,
    session: object,
  ): Promise<void>;
}
