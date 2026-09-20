import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  type ClientSession,
  type Connection,
  type Model,
  type PipelineStage,
  type Schema,
  type Types,
} from 'mongoose';
import { duplicateKeyIs } from '../../../infrastructure/mongo/duplicate-key';
import { GroupDeletionHooks } from '../application/group-deletion-hooks';
import type {
  AddMemberInput,
  CreateGroupInput,
  DeleteGroupResult,
  GroupRepository,
  RemoveMemberResult,
  TransferOwnershipResult,
  UserGroup,
} from '../application/ports/group-repository.port';
import {
  INVITE_CODE_GENERATOR,
  InviteCodeUnavailable,
  MAX_INVITE_CODE_ATTEMPTS,
  type InviteCodeGenerator,
} from '../application/ports/invite-code-generator.port';
import {
  createGroup,
  visibilityOf,
  type Group,
  type GroupVisibility,
} from '../domain/group';
import type { Membership } from '../domain/membership';
import {
  GROUP_MEMBER_MODEL_NAME,
  GROUP_MODEL_NAME,
  GROUPS_COLLECTION,
  groupMemberSchema,
  groupSchema,
  toGroupObjectId,
  INVITE_KEY,
  MEMBERSHIP_KEY,
  toUserObjectId,
  type GroupDocument,
  type GroupMemberDocument,
} from './group.schemas';

// Adaptador Mongo de GROUP_REPOSITORY (D1, D3 y D6 de groups) sobre la conexión Mongoose de la app
// (`getConnectionToken()`).
//
// - El grupo y la membresía `owner` se escriben en una transacción: nunca queda un grupo sin owner con código válido.
// - La unicidad del código es del índice; el reintento vive aquí (el generador es puro y no consulta nada).
// - Un identificador mal formado no llega a Mongo (guarda de `group.schemas`): responde `null` o un resultado negativo,
//   nunca CastError.
// - Las claves duplicadas se reconocen por el `keyPattern` completo del índice (`duplicateKeyIs`, ADR-025 §4).

function modelOf<T>(
  connection: Connection,
  name: string,
  schema: Schema<T>,
): Model<T> {
  return (
    (connection.models[name] as Model<T> | undefined) ??
    connection.model<T>(name, schema)
  );
}

/**
 * Centinela de `transferOwnership`: el elegido no es `member` del grupo. Se lanza dentro de la transacción para abortarla
 * y deshacer la degradación del owner, y nunca sale del repositorio.
 */
class TargetNotMember extends Error {
  override readonly name = 'TargetNotMember';

  constructor() {
    super('The ownership target is not a member of the group');
  }
}

@Injectable()
export class MongoGroupRepository implements GroupRepository {
  private readonly groups: Model<GroupDocument>;
  private readonly members: Model<GroupMemberDocument>;

  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
    @Inject(INVITE_CODE_GENERATOR) private readonly codes: InviteCodeGenerator,
    private readonly deletionHooks: GroupDeletionHooks,
  ) {
    this.groups = modelOf<GroupDocument>(
      connection,
      GROUP_MODEL_NAME,
      groupSchema,
    );
    this.members = modelOf<GroupMemberDocument>(
      connection,
      GROUP_MEMBER_MODEL_NAME,
      groupMemberSchema,
    );
  }

  /**
   * Grupo y membresía `owner` en la misma transacción (D6). El reintento del código va por fuera: una transacción que
   * abortó por la clave duplicada no se puede continuar, así que se repite entera con un código nuevo (D3).
   */
  async create(input: CreateGroupInput): Promise<Group> {
    const ownerId = toUserObjectId(input.ownerId);
    if (ownerId === null) {
      throw new Error('A group owner needs a well formed user id');
    }
    for (let attempt = 0; attempt < MAX_INVITE_CODE_ATTEMPTS; attempt += 1) {
      const draft = createGroup({
        name: input.name,
        inviteCode: this.codes.generate(),
        now: input.now,
      });
      try {
        return await this.withTransaction(async (session) => {
          const created = await this.groups.create([draft], { session });
          const group = created[0];
          if (group === undefined) {
            throw new Error('The group insert returned no document');
          }
          await this.members.create(
            [
              {
                groupId: group._id,
                userId: ownerId,
                role: 'owner',
                joinedAt: input.now,
              },
            ],
            { session },
          );
          return toGroup(group.toObject());
        });
      } catch (error) {
        if (!duplicateKeyIs(error, INVITE_KEY)) {
          throw error;
        }
      }
    }
    throw new InviteCodeUnavailable();
  }

  async findById(groupId: string): Promise<Group | null> {
    const id = toGroupObjectId(groupId);
    if (id === null) {
      return null;
    }
    const document = await this.groups.findById(id).lean().exec();
    return document ? toGroup(document) : null;
  }

  async findByInviteCode(inviteCode: string): Promise<Group | null> {
    const document = await this.groups.findOne({ inviteCode }).lean().exec();
    return document ? toGroup(document) : null;
  }

  async findMembership(
    groupId: string,
    userId: string,
  ): Promise<Membership | null> {
    const ids = this.toMembershipIds(groupId, userId);
    if (ids === null) {
      return null;
    }
    const document = await this.members.findOne(ids).lean().exec();
    return document ? toMembership(document) : null;
  }

  async listGroupsOfUser(userId: string): Promise<UserGroup[]> {
    const id = toUserObjectId(userId);
    if (id === null) {
      return [];
    }
    const rows = await this.members
      .aggregate<{
        group: GroupDocument;
        role: GroupMemberDocument['role'];
        joinedAt: Date;
      }>([
        ...groupsOfUserStages(id),
        { $project: { _id: 0, group: 1, role: 1, joinedAt: 1 } },
      ])
      .exec();
    return rows.map((row) => ({
      group: toGroup(row.group),
      role: row.role,
      joinedAt: row.joinedAt,
    }));
  }

  async countGroupsOfUser(userId: string): Promise<number> {
    const id = toUserObjectId(userId);
    if (id === null) {
      return 0;
    }
    const rows = await this.members
      .aggregate<{ total: number }>([
        ...groupsOfUserStages(id),
        { $count: 'total' },
      ])
      .exec();
    return rows[0]?.total ?? 0;
  }

  async listMembers(groupId: string): Promise<Membership[]> {
    const id = toGroupObjectId(groupId);
    if (id === null) {
      return [];
    }
    const documents = await this.members
      .find({ groupId: id })
      .sort({ joinedAt: 1 })
      .lean()
      .exec();
    return documents.map((document) => toMembership(document));
  }

  /** Una sola agregación para todos los grupos: es el patrón que heredará `job-links` para contar links (D1). */
  async countMembers(
    groupIds: readonly string[],
  ): Promise<Map<string, number>> {
    const ids = groupIds
      .map((groupId) => toGroupObjectId(groupId))
      .filter((id): id is Types.ObjectId => id !== null);
    if (ids.length === 0) {
      return new Map();
    }
    const rows = await this.members
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { groupId: { $in: ids } } },
        { $group: { _id: '$groupId', count: { $sum: 1 } } },
      ])
      .exec();
    return new Map(rows.map((row) => [row._id.toHexString(), row.count]));
  }

  async addMember(input: AddMemberInput): Promise<Membership> {
    const ids = this.toMembershipIds(input.groupId, input.userId);
    if (ids === null) {
      throw new Error('A membership needs well formed group and user ids');
    }
    try {
      const created = await this.members.create({
        ...ids,
        role: 'member',
        joinedAt: input.now,
      });
      return toMembership(created.toObject());
    } catch (error) {
      // Carrera con otra unión: el índice único de membresía rechazó la segunda, así que ya era miembro (D5). Solo ese
      // índice: una violación de `OWNER_KEY` es un fallo de programación y sube como 500 (ADR-025 §4).
      if (duplicateKeyIs(error, MEMBERSHIP_KEY)) {
        const existing = await this.findMembership(input.groupId, input.userId);
        if (existing !== null) {
          return existing;
        }
      }
      throw error;
    }
  }

  /**
   * Degradar y promover en una transacción, cada paso condicionado por rol y en este orden (ADR-025 §1 y §2): el índice
   * `one_owner_per_group` se comprueba por sentencia, así que promover primero chocaría con él. Si el paso 1 no modifica
   * nada, quien pide ya no es owner y no se ha escrito nada. Si el paso 2 no modifica nada, se **lanza** el centinela
   * `TargetNotMember` para que `withTransaction` aborte y deshaga el paso 1; devolver un valor confirmaría la transacción
   * con el grupo sin owner. El centinela se traduce fuera de la transacción.
   */
  async transferOwnership(
    groupId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<TransferOwnershipResult> {
    const from = this.toMembershipIds(groupId, fromUserId);
    if (from === null) {
      return 'not_owner';
    }
    const to = this.toMembershipIds(groupId, toUserId);
    if (to === null || fromUserId === toUserId) {
      return 'target_not_member';
    }
    try {
      return await this.withTransaction(async (session) => {
        const demoted = await this.members
          .updateOne({ ...from, role: 'owner' }, { $set: { role: 'member' } })
          .session(session)
          .exec();
        if (demoted.modifiedCount !== 1) {
          return 'not_owner';
        }
        const promoted = await this.members
          .updateOne({ ...to, role: 'member' }, { $set: { role: 'owner' } })
          .session(session)
          .exec();
        if (promoted.modifiedCount !== 1) {
          throw new TargetNotMember();
        }
        return 'transferred';
      });
    } catch (error) {
      if (error instanceof TargetNotMember) {
        return 'target_not_member';
      }
      throw error;
    }
  }

  async removeMember(
    groupId: string,
    userId: string,
  ): Promise<RemoveMemberResult> {
    const ids = this.toMembershipIds(groupId, userId);
    if (ids === null) {
      return 'not_member';
    }
    // No exige que el grupo exista: una membresía huérfana también se suelta y libera la plaza (D6). Solo borra una
    // membresía `member`: si quien sale o es expulsado acaba de recibir la propiedad, no se toca (ADR-025 §3).
    const result = await this.members
      .deleteOne({ ...ids, role: 'member' })
      .exec();
    if (result.deletedCount === 1) {
      return 'removed';
    }
    // No borró nada: se relee para distinguir "ahora es owner" de "no existe".
    const current = await this.members.findOne(ids).lean().exec();
    return current?.role === 'owner' ? 'now_owner' : 'not_member';
  }

  async rename(
    groupId: string,
    name: string,
    now: Date,
  ): Promise<Group | null> {
    const id = toGroupObjectId(groupId);
    if (id === null) {
      return null;
    }
    const document = await this.groups
      .findByIdAndUpdate(
        id,
        { $set: { name, updatedAt: now } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    return document ? toGroup(document) : null;
  }

  /**
   * Escribe la visibilidad por defecto del grupo (D3 de public-preview-share). Toca **solo** el documento del grupo: no
   * escribe en ningún link, ni publica, ni despublica, ni sube ninguna revisión.
   */
  async updateSettings(
    groupId: string,
    defaultVisibility: GroupVisibility,
    now: Date,
  ): Promise<Group | null> {
    const id = toGroupObjectId(groupId);
    if (id === null) {
      return null;
    }
    const document = await this.groups
      .findByIdAndUpdate(
        id,
        { $set: { settings: { defaultVisibility }, updatedAt: now } },
        { returnDocument: 'after', runValidators: true },
      )
      .lean()
      .exec();
    return document ? toGroup(document) : null;
  }

  async rotateInviteCode(groupId: string, now: Date): Promise<Group | null> {
    const id = toGroupObjectId(groupId);
    if (id === null) {
      return null;
    }
    for (let attempt = 0; attempt < MAX_INVITE_CODE_ATTEMPTS; attempt += 1) {
      try {
        const document = await this.groups
          .findByIdAndUpdate(
            id,
            { $set: { inviteCode: this.codes.generate(), updatedAt: now } },
            { returnDocument: 'after', runValidators: true },
          )
          .lean()
          .exec();
        return document ? toGroup(document) : null;
      } catch (error) {
        if (!duplicateKeyIs(error, INVITE_KEY)) {
          throw error;
        }
      }
    }
    throw new InviteCodeUnavailable();
  }

  /**
   * Grupo, membresías y lo que otros módulos cuelguen de él, en la misma transacción: nadie queda mirando un grupo a
   * medio borrar (D6) ni deja relaciones huérfanas (D7b).
   *
   * Lo primero es borrar la membresía `owner` de quien pide (ADR-025 §3): ser propietario se comprueba **al escribir**,
   * así que quien acaba de transferir en otra pestaña no borra el grupo del nuevo owner. Si no hay nada que borrar, se
   * relee el grupo para distinguir `not_owner` de `not_found`, y no se ha escrito nada. Los hooks corren **después** de
   * eso, así que un borrado rechazado no ejecuta ninguno, y **antes** de terminar la transacción, así que si uno falla no
   * se borra tampoco el grupo ni la membresía `owner`.
   */
  async deleteGroup(
    groupId: string,
    ownerId: string,
  ): Promise<DeleteGroupResult> {
    const id = toGroupObjectId(groupId);
    if (id === null) {
      return 'not_found';
    }
    const owner = toUserObjectId(ownerId);
    return await this.withTransaction(async (session) => {
      const owned =
        owner === null
          ? 0
          : (
              await this.members
                .deleteOne({ groupId: id, userId: owner, role: 'owner' })
                .session(session)
                .exec()
            ).deletedCount;
      if (owned !== 1) {
        const exists = await this.groups
          .exists({ _id: id })
          .session(session)
          .exec();
        return exists === null ? 'not_found' : 'not_owner';
      }
      const deleted = await this.groups
        .deleteOne({ _id: id })
        .session(session)
        .exec();
      if (deleted.deletedCount !== 1) {
        // Membresía `owner` huérfana (su grupo ya no estaba): se suelta, como cualquier huérfana (D6).
        return 'not_found';
      }
      await this.members.deleteMany({ groupId: id }).session(session).exec();
      await this.deletionHooks.runAll(groupId, session);
      return 'deleted';
    });
  }

  /** `null` si alguno de los dos identificadores no tiene el formato esperado. */
  private toMembershipIds(
    groupId: string,
    userId: string,
  ): { groupId: Types.ObjectId; userId: Types.ObjectId } | null {
    const group = toGroupObjectId(groupId);
    const user = toUserObjectId(userId);
    return group === null || user === null
      ? null
      : { groupId: group, userId: user };
  }

  private async withTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(() => work(session));
    } finally {
      await session.endSession();
    }
  }
}

/**
 * Membresías del usuario cuyo grupo sigue existiendo, de la más reciente a la más antigua. El `$unwind` descarta las
 * huérfanas (D6), y por eso la misma consulta sirve para la lista y para el conteo del límite de 20 grupos (D4).
 */
function groupsOfUserStages(userId: Types.ObjectId): PipelineStage[] {
  return [
    { $match: { userId } },
    { $sort: { joinedAt: -1 } },
    {
      $lookup: {
        from: GROUPS_COLLECTION,
        localField: 'groupId',
        foreignField: '_id',
        as: 'group',
      },
    },
    { $unwind: '$group' },
  ];
}

function toGroup(document: GroupDocument): Group {
  return {
    id: document._id.toHexString(),
    name: document.name,
    inviteCode: document.inviteCode,
    // Un grupo anterior al ajuste no tiene `settings` y se lee como público (D3): no hay backfill.
    defaultVisibility: visibilityOf(document.settings?.defaultVisibility),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toMembership(document: GroupMemberDocument): Membership {
  return {
    groupId: document.groupId.toHexString(),
    userId: document.userId.toHexString(),
    role: document.role,
    joinedAt: document.joinedAt,
  };
}
