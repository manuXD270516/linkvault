import {
  createGroup,
  renameGroup,
  withDefaultVisibility,
  withInviteCode,
  type Group,
  type GroupVisibility,
} from '../../domain/group';
import { isGroupId, isUserId } from '../../domain/identifier';
import { createMembership, type Membership } from '../../domain/membership';
import type {
  AddMemberInput,
  CreateGroupInput,
  DeleteGroupResult,
  GroupRepository,
  RemoveMemberResult,
  TransferOwnershipResult,
  UserGroup,
} from '../ports/group-repository.port';
import {
  InviteCodeUnavailable,
  MAX_INVITE_CODE_ATTEMPTS,
  type InviteCodeGenerator,
} from '../ports/invite-code-generator.port';

// Repositorio en memoria para tests de application (D11 de groups). No es un adaptador de producción: el real es
// `MongoGroupRepository`. Aplica el mismo predicado de identificador y el mismo reintento de código que él, para que un
// caso de uso probado aquí se comporte igual contra Mongo. Devuelve copias: un test no altera el estado por accidente.

export class InMemoryGroupRepository implements GroupRepository {
  private readonly groups = new Map<string, Group>();
  private readonly memberships: Membership[] = [];
  private nextId = 1;
  private peersAmongCalls = 0;

  constructor(private readonly codes: InviteCodeGenerator) {}

  /** Cuántos grupos hay guardados; lo usan los tests que comprueban que una escritura no dejó rastro. */
  get size(): number {
    return this.groups.size;
  }

  /** Cuántas consultas de `peersAmong` se han hecho (una por llamada, como en Mongo); lo miden los tests. */
  get peersAmongQueries(): number {
    return this.peersAmongCalls;
  }

  // `async` aunque no espere a nadie: un código agotado tiene que rechazar la promesa, no lanzar en la llamada.
  async create(input: CreateGroupInput): Promise<Group> {
    const id = this.nextGroupId();
    const group: Group = {
      ...createGroup({
        name: input.name,
        inviteCode: this.freeInviteCode(),
        now: input.now,
      }),
      id,
    };
    this.groups.set(id, group);
    // Grupo y membresía `owner` juntos: el equivalente en memoria de la transacción (D6).
    this.memberships.push(
      createMembership({
        groupId: id,
        userId: input.ownerId,
        role: 'owner',
        now: input.now,
      }),
    );
    return structuredClone(group);
  }

  findById(groupId: string): Promise<Group | null> {
    if (!isGroupId(groupId)) {
      return Promise.resolve(null);
    }
    const group = this.groups.get(groupId);
    return Promise.resolve(group ? structuredClone(group) : null);
  }

  findByInviteCode(inviteCode: string): Promise<Group | null> {
    for (const group of this.groups.values()) {
      if (group.inviteCode === inviteCode) {
        return Promise.resolve(structuredClone(group));
      }
    }
    return Promise.resolve(null);
  }

  findMembership(groupId: string, userId: string): Promise<Membership | null> {
    if (!isGroupId(groupId) || !isUserId(userId)) {
      return Promise.resolve(null);
    }
    const membership = this.memberships.find(
      (candidate) =>
        candidate.groupId === groupId && candidate.userId === userId,
    );
    return Promise.resolve(membership ? structuredClone(membership) : null);
  }

  listGroupsOfUser(userId: string): Promise<UserGroup[]> {
    return Promise.resolve(
      this.groupsOfUser(userId)
        .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime())
        .map((entry) => structuredClone(entry)),
    );
  }

  countGroupsOfUser(userId: string): Promise<number> {
    return Promise.resolve(this.groupsOfUser(userId).length);
  }

  peersAmong(
    userId: string,
    candidateIds: readonly string[],
  ): Promise<Set<string>> {
    this.peersAmongCalls += 1;
    const peers = new Set<string>();
    if (!isUserId(userId)) {
      return Promise.resolve(peers);
    }
    const viewerGroups = new Set(
      this.groupsOfUser(userId).map((entry) => entry.group.id),
    );
    const wanted = new Set(candidateIds.filter((id) => isUserId(id)));
    for (const membership of this.memberships) {
      if (
        wanted.has(membership.userId) &&
        viewerGroups.has(membership.groupId)
      ) {
        peers.add(membership.userId);
      }
    }
    return Promise.resolve(peers);
  }

  listMembers(groupId: string): Promise<Membership[]> {
    if (!isGroupId(groupId)) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      this.memberships
        .filter((membership) => membership.groupId === groupId)
        .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())
        .map((membership) => structuredClone(membership)),
    );
  }

  countMembers(groupIds: readonly string[]): Promise<Map<string, number>> {
    const wanted = new Set(groupIds.filter((id) => isGroupId(id)));
    const counts = new Map<string, number>();
    for (const membership of this.memberships) {
      if (wanted.has(membership.groupId)) {
        counts.set(
          membership.groupId,
          (counts.get(membership.groupId) ?? 0) + 1,
        );
      }
    }
    return Promise.resolve(counts);
  }

  addMember(input: AddMemberInput): Promise<Membership> {
    const existing = this.memberships.find(
      (membership) =>
        membership.groupId === input.groupId &&
        membership.userId === input.userId,
    );
    if (existing) {
      return Promise.resolve(structuredClone(existing));
    }
    const membership = createMembership({
      groupId: input.groupId,
      userId: input.userId,
      role: 'member',
      now: input.now,
    });
    this.memberships.push(membership);
    return Promise.resolve(structuredClone(membership));
  }

  /**
   * Mismas escrituras condicionadas por rol que el adaptador de Mongo: degradar exige que `from` sea `owner` y promover
   * que `to` sea `member`. Se comprueba todo antes de escribir, el equivalente en memoria de la transacción que deshace
   * el primer paso si el segundo no encuentra al elegido (ADR-025 §1).
   */
  transferOwnership(
    groupId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<TransferOwnershipResult> {
    const from = this.indexOfMembership(groupId, fromUserId, 'owner');
    if (from === -1) {
      return Promise.resolve('not_owner');
    }
    const to =
      fromUserId === toUserId
        ? -1
        : this.indexOfMembership(groupId, toUserId, 'member');
    if (to === -1) {
      return Promise.resolve('target_not_member');
    }
    this.setRole(from, 'member');
    this.setRole(to, 'owner');
    return Promise.resolve('transferred');
  }

  /** Solo borra una membresía `member`; si es `owner`, no la toca y dice `now_owner` (ADR-025 §3). */
  removeMember(groupId: string, userId: string): Promise<RemoveMemberResult> {
    const index = this.indexOfMembership(groupId, userId);
    const membership = this.memberships[index];
    if (membership === undefined) {
      return Promise.resolve('not_member');
    }
    if (membership.role === 'owner') {
      return Promise.resolve('now_owner');
    }
    this.memberships.splice(index, 1);
    return Promise.resolve('removed');
  }

  rename(groupId: string, name: string, now: Date): Promise<Group | null> {
    return this.update(groupId, (group) => renameGroup(group, name, now));
  }

  /** Igual que el adaptador de Mongo: cambia el ajuste del grupo y nada más (D3 de public-preview-share). */
  updateSettings(
    groupId: string,
    defaultVisibility: GroupVisibility,
    now: Date,
  ): Promise<Group | null> {
    return this.update(groupId, (group) =>
      withDefaultVisibility(group, defaultVisibility, now),
    );
  }

  async rotateInviteCode(groupId: string, now: Date): Promise<Group | null> {
    return await this.update(groupId, (group) =>
      withInviteCode(group, this.freeInviteCode(), now),
    );
  }

  /**
   * Borra el grupo solo si `ownerId` es su owner al escribir (ADR-025 §3). Sin la membresía `owner` de quien pide,
   * distingue el grupo que no existe (`not_found`) del que es de otro (`not_owner`), sin borrar nada.
   */
  deleteGroup(groupId: string, ownerId: string): Promise<DeleteGroupResult> {
    return this.deleteGroupInSession(groupId, ownerId, {});
  }

  deleteGroupInSession(
    groupId: string,
    ownerId: string,
    _session: object,
  ): Promise<DeleteGroupResult> {
    if (!isGroupId(groupId) || !this.groups.has(groupId)) {
      return Promise.resolve('not_found');
    }
    if (this.indexOfMembership(groupId, ownerId, 'owner') === -1) {
      return Promise.resolve('not_owner');
    }
    this.groups.delete(groupId);
    for (let index = this.memberships.length - 1; index >= 0; index -= 1) {
      if (this.memberships[index]?.groupId === groupId) {
        this.memberships.splice(index, 1);
      }
    }
    return Promise.resolve('deleted');
  }

  removeMembershipInSession(
    groupId: string,
    userId: string,
    _session: object,
  ): Promise<void> {
    const index = this.indexOfMembership(groupId, userId);
    if (index !== -1) {
      this.memberships.splice(index, 1);
    }
    return Promise.resolve();
  }

  /** Posición de la membresía, con el rol pedido si se indica; -1 si no está o algún id está mal formado. */
  private indexOfMembership(
    groupId: string,
    userId: string,
    role?: Membership['role'],
  ): number {
    if (!isGroupId(groupId) || !isUserId(userId)) {
      return -1;
    }
    return this.memberships.findIndex(
      (membership) =>
        membership.groupId === groupId &&
        membership.userId === userId &&
        (role === undefined || membership.role === role),
    );
  }

  /** Cambia el rol sin tocar `joinedAt`: las membresías son inmutables, así que se sustituye la entrada. */
  private setRole(index: number, role: Membership['role']): void {
    const membership = this.memberships[index];
    if (membership !== undefined) {
      this.memberships[index] = { ...membership, role };
    }
  }

  private update(
    groupId: string,
    change: (group: Group) => Group,
  ): Promise<Group | null> {
    if (!isGroupId(groupId)) {
      return Promise.resolve(null);
    }
    const group = this.groups.get(groupId);
    if (!group) {
      return Promise.resolve(null);
    }
    const updated = change(group);
    this.groups.set(groupId, updated);
    return Promise.resolve(structuredClone(updated));
  }

  /** Membresías del usuario cuyo grupo sigue existiendo: las huérfanas quedan fuera de la lista y del límite (D6). */
  private groupsOfUser(userId: string): UserGroup[] {
    if (!isUserId(userId)) {
      return [];
    }
    const entries: UserGroup[] = [];
    for (const membership of this.memberships) {
      if (membership.userId !== userId) {
        continue;
      }
      const group = this.groups.get(membership.groupId);
      if (group) {
        entries.push({
          group,
          role: membership.role,
          joinedAt: membership.joinedAt,
        });
      }
    }
    return entries;
  }

  /** Mismo reintento que el adaptador de Mongo: pide otro código al generador hasta que uno esté libre (D3). */
  private freeInviteCode(): string {
    for (let attempt = 0; attempt < MAX_INVITE_CODE_ATTEMPTS; attempt += 1) {
      const code = this.codes.generate();
      const taken = [...this.groups.values()].some(
        (group) => group.inviteCode === code,
      );
      if (!taken) {
        return code;
      }
    }
    throw new InviteCodeUnavailable();
  }

  private nextGroupId(): string {
    const id = this.nextId.toString(16).padStart(24, '0');
    this.nextId += 1;
    return id;
  }
}
