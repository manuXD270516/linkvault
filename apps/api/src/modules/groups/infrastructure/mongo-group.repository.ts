import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  mongo,
  type ClientSession,
  type Connection,
  type Model,
  type PipelineStage,
  type Schema,
  type Types,
} from 'mongoose';
import type {
  AddMemberInput,
  CreateGroupInput,
  GroupRepository,
  UserGroup,
} from '../application/ports/group-repository.port';
import {
  INVITE_CODE_GENERATOR,
  InviteCodeUnavailable,
  MAX_INVITE_CODE_ATTEMPTS,
  type InviteCodeGenerator,
} from '../application/ports/invite-code-generator.port';
import { createGroup, type Group } from '../domain/group';
import type { Membership } from '../domain/membership';
import {
  GROUP_MEMBER_MODEL_NAME,
  GROUP_MODEL_NAME,
  GROUPS_COLLECTION,
  groupMemberSchema,
  groupSchema,
  toGroupObjectId,
  toUserObjectId,
  type GroupDocument,
  type GroupMemberDocument,
} from './group.schemas';

// Adaptador Mongo de GROUP_REPOSITORY (D1, D3 y D6 de groups) sobre la conexión Mongoose de la app
// (`getConnectionToken()`).
//
// - El grupo y la membresía `owner` se escriben en una transacción: nunca queda un grupo sin owner con código válido.
// - La unicidad del código es del índice; el reintento vive aquí (el generador es puro y no consulta nada).
// - Un identificador mal formado no llega a Mongo (guarda de `group.schemas`): responde `null`/`false`, nunca CastError.

const DUPLICATE_KEY = 11_000;

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

/** Campos del índice único que rechazó la escritura; vacío si el error no es una clave duplicada. */
function duplicateKeyFields(error: unknown): string[] {
  if (
    !(error instanceof mongo.MongoServerError) ||
    error.code !== DUPLICATE_KEY
  ) {
    return [];
  }
  const pattern: unknown = error['keyPattern'];
  return typeof pattern === 'object' && pattern !== null
    ? Object.keys(pattern)
    : [];
}

@Injectable()
export class MongoGroupRepository implements GroupRepository {
  private readonly groups: Model<GroupDocument>;
  private readonly members: Model<GroupMemberDocument>;

  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
    @Inject(INVITE_CODE_GENERATOR) private readonly codes: InviteCodeGenerator,
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
        if (!duplicateKeyFields(error).includes('inviteCode')) {
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
      // Carrera con otra unión: el índice único rechazó la segunda, así que ya era miembro (D5).
      if (duplicateKeyFields(error).includes('groupId')) {
        const existing = await this.findMembership(input.groupId, input.userId);
        if (existing !== null) {
          return existing;
        }
      }
      throw error;
    }
  }

  async removeMember(groupId: string, userId: string): Promise<boolean> {
    const ids = this.toMembershipIds(groupId, userId);
    if (ids === null) {
      return false;
    }
    // No exige que el grupo exista: una membresía huérfana también se suelta y libera la plaza (D6).
    const result = await this.members.deleteOne(ids).exec();
    return result.deletedCount === 1;
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
        if (!duplicateKeyFields(error).includes('inviteCode')) {
          throw error;
        }
      }
    }
    throw new InviteCodeUnavailable();
  }

  /** Grupo y membresías en la misma transacción: nadie queda mirando un grupo a medio borrar (D6). */
  async deleteGroup(groupId: string): Promise<boolean> {
    const id = toGroupObjectId(groupId);
    if (id === null) {
      return false;
    }
    return await this.withTransaction(async (session) => {
      const deleted = await this.groups
        .deleteOne({ _id: id })
        .session(session)
        .exec();
      if (deleted.deletedCount !== 1) {
        return false;
      }
      await this.members.deleteMany({ groupId: id }).session(session).exec();
      return true;
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
