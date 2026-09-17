import type { Group } from '../../domain/group';
import type { GroupRole, Membership } from '../../domain/membership';

// Puerto de persistencia de grupos y membresías (D1 de groups). Se inyecta con
// `{ provide: GROUP_REPOSITORY, useClass: MongoGroupRepository }`. Solo tipos y el token.
//
// Ningún método lanza por un identificador mal formado: devuelven `null`, `false` o una lista vacía (D2), y el caso de
// uso los convierte en el 404 uniforme. El repositorio no juzga roles ni límites: eso es del dominio.

export const GROUP_REPOSITORY = Symbol('GROUP_REPOSITORY');

/** Grupo del usuario junto con su membresía. Las membresías huérfanas (grupo ya borrado) no se devuelven (D6). */
export interface UserGroup {
  readonly group: Group;
  readonly role: GroupRole;
  readonly joinedAt: Date;
}

export interface CreateGroup {
  /** Nombre ya normalizado y validado por el caso de uso. */
  readonly name: string;
  /** Usuario que queda como `owner`; su membresía se escribe en la misma transacción. */
  readonly ownerId: string;
  readonly now: Date;
}

export interface AddMember {
  readonly groupId: string;
  readonly userId: string;
  readonly now: Date;
}

export interface GroupRepository {
  /**
   * Crea el grupo y la membresía `owner` en una transacción: nunca queda un grupo sin owner con un código válido (D6).
   * El código de invitación lo pide al generador y reintenta ante una colisión del índice único (D3).
   */
  create(input: CreateGroup): Promise<Group>;
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
  addMember(input: AddMember): Promise<Membership>;
  /**
   * Borra la membresía; `false` si no existía. No exige que el grupo exista, para que una membresía huérfana se pueda
   * soltar y libere la plaza (D6). Quién puede salir o ser expulsado lo decide el caso de uso con el dominio.
   */
  removeMember(groupId: string, userId: string): Promise<boolean>;
  /** Grupo renombrado; `null` si no existe o el id está mal formado. */
  rename(groupId: string, name: string, now: Date): Promise<Group | null>;
  /** Grupo con un código nuevo, con el mismo reintento que `create`; `null` si no existe. */
  rotateInviteCode(groupId: string, now: Date): Promise<Group | null>;
  /** Borra el grupo y todas sus membresías en una transacción; `false` si el grupo no existía. */
  deleteGroup(groupId: string): Promise<boolean>;
}
