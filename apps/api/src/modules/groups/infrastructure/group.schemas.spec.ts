import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { mongo, type Connection, type Schema } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GROUP_ROLES } from '../domain/membership';
import { duplicateKeyIs } from '../../../infrastructure/mongo/duplicate-key';
import {
  GROUP_MEMBER_MODEL_NAME,
  GROUP_MEMBERS_COLLECTION,
  GROUP_MODEL_NAME,
  GROUPS_COLLECTION,
  groupMemberSchema,
  groupSchema,
  INVITE_KEY,
  MEMBERSHIP_KEY,
  ONE_OWNER_PER_GROUP_INDEX,
  OWNER_KEY,
  toGroupObjectId,
  toUserObjectId,
  type GroupDocument,
  type GroupMemberDocument,
} from './group.schemas';

// Schemas de `groups` y `group_members` (tarea 3.2 de groups) contra el MongoMemoryReplSet del preset de
// @linkvault/testing. Se espera `Model.init()` antes de probar los índices (D11).

let connection: Connection;

const now = new Date('2026-09-17T10:00:00.000Z');
const GROUP_ID = new mongoose.Types.ObjectId();
const USER_ID = new mongoose.Types.ObjectId();

/** Error con el que falla la escritura, o `undefined` si no falló. */
async function writeError(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** Código del error del driver, o `undefined` si la escritura no falló. `11000` es la clave duplicada. */
async function writeErrorCode(
  write: Promise<unknown>,
): Promise<number | string | undefined> {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error instanceof mongo.MongoServerError ? error.code : undefined;
  }
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `groups-${randomUUID()}` })
    .asPromise();
  connection.model<GroupDocument>(GROUP_MODEL_NAME, groupSchema);
  connection.model<GroupMemberDocument>(
    GROUP_MEMBER_MODEL_NAME,
    groupMemberSchema,
  );
  await connection.model(GROUP_MODEL_NAME).init();
  await connection.model(GROUP_MEMBER_MODEL_NAME).init();
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('groups collection', () => {
  it('declares bufferCommands false and a unique index on the invite code', async () => {
    expect(groupSchema.get('bufferCommands')).toBe(false);
    const indexes = await connection.collection(GROUPS_COLLECTION).indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { inviteCode: 1 }, unique: true }),
    );
  });

  it('rejects a second group with the same invite code', async () => {
    const model = connection.model<GroupDocument>(GROUP_MODEL_NAME);
    await model.create({
      name: 'Backend Bolivia',
      inviteCode: 'A2B3C4D5',
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      writeErrorCode(
        model.create({
          name: 'Otro',
          inviteCode: 'A2B3C4D5',
          createdAt: now,
          updatedAt: now,
        }),
      ),
    ).resolves.toBe(11_000);
  });

  it('does not store an owner: the ownership lives in the membership', async () => {
    const model = connection.model<GroupDocument>(GROUP_MODEL_NAME);
    const created = await model.create({
      name: 'Sin owner',
      inviteCode: 'Z9Y8X7W6',
      createdAt: now,
      updatedAt: now,
    });

    const raw = await connection
      .collection(GROUPS_COLLECTION)
      .findOne({ _id: created._id });

    expect(raw).toEqual({
      _id: created._id,
      name: 'Sin owner',
      inviteCode: 'Z9Y8X7W6',
      createdAt: now,
      updatedAt: now,
    });
  });
});

describe('group settings', () => {
  it('guarda y relee la visibilidad por defecto', async () => {
    const model = connection.model<GroupDocument>(GROUP_MODEL_NAME);
    const created = await model.create({
      name: 'Con ajuste',
      inviteCode: 'S1S2S3S4',
      settings: { defaultVisibility: 'private' },
      createdAt: now,
      updatedAt: now,
    });

    const raw = await connection
      .collection(GROUPS_COLLECTION)
      .findOne({ _id: created._id });

    expect(raw).toEqual({
      _id: created._id,
      name: 'Con ajuste',
      inviteCode: 'S1S2S3S4',
      settings: { defaultVisibility: 'private' },
      createdAt: now,
      updatedAt: now,
    });
  });

  it('acepta solo los dos valores del contrato', () => {
    const settings = groupSchema.path('settings') as unknown as {
      schema: Schema;
    };

    expect(
      settings.schema.path('defaultVisibility').options['enum'],
    ).toEqual(['public', 'private']);
  });

  it('deja el campo fuera cuando el grupo nunca miró el ajuste', async () => {
    const model = connection.model<GroupDocument>(GROUP_MODEL_NAME);
    const created = await model.create({
      name: 'Sin ajuste',
      inviteCode: 'S5S6S7S8',
      createdAt: now,
      updatedAt: now,
    });

    const raw = await connection
      .collection(GROUPS_COLLECTION)
      .findOne({ _id: created._id });

    expect(raw).not.toHaveProperty('settings');
  });

  // Este change NO añade ningún índice a `groups` ni a `group_members` (D11): nadie busca por el ajuste.
  it('no añade ningún índice', async () => {
    const groupIndexes = await connection
      .collection(GROUPS_COLLECTION)
      .indexes();
    const memberIndexes = await connection
      .collection(GROUP_MEMBERS_COLLECTION)
      .indexes();

    expect(groupIndexes.map((index) => index.key)).toEqual([
      { _id: 1 },
      { inviteCode: 1 },
    ]);
    expect(memberIndexes.map((index) => index.key)).toEqual([
      { _id: 1 },
      { groupId: 1, userId: 1 },
      { groupId: 1 },
      { userId: 1, joinedAt: -1 },
      { groupId: 1, joinedAt: 1 },
    ]);
  });
});

describe('group_members collection', () => {
  it('declares the indexes of the membership lists', async () => {
    expect(groupMemberSchema.get('bufferCommands')).toBe(false);
    const indexes = await connection
      .collection(GROUP_MEMBERS_COLLECTION)
      .indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({
        key: { groupId: 1, userId: 1 },
        unique: true,
      }),
    );
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { userId: 1, joinedAt: -1 } }),
    );
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { groupId: 1, joinedAt: 1 } }),
    );
  });

  it('rejects a duplicate membership of the same user in the same group', async () => {
    const model = connection.model<GroupMemberDocument>(
      GROUP_MEMBER_MODEL_NAME,
    );
    await model.create({
      groupId: GROUP_ID,
      userId: USER_ID,
      role: 'owner',
      joinedAt: now,
    });

    await expect(
      writeErrorCode(
        model.create({
          groupId: GROUP_ID,
          userId: USER_ID,
          role: 'member',
          joinedAt: now,
        }),
      ),
    ).resolves.toBe(11_000);
    expect(
      await connection
        .collection(GROUP_MEMBERS_COLLECTION)
        .countDocuments({ groupId: GROUP_ID, userId: USER_ID }),
    ).toBe(1);
  });

  it('accepts only the roles of the domain', () => {
    expect(groupMemberSchema.path('role').options['enum']).toEqual(GROUP_ROLES);
  });
});

describe('one owner per group', () => {
  it('declares the partial unique index with its explicit name', async () => {
    const indexes = await connection
      .collection(GROUP_MEMBERS_COLLECTION)
      .indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({
        name: ONE_OWNER_PER_GROUP_INDEX,
        key: { groupId: 1 },
        unique: true,
        partialFilterExpression: { role: 'owner' },
      }),
    );
  });

  it('rejects a second owner membership in the same group', async () => {
    const model = connection.model<GroupMemberDocument>(
      GROUP_MEMBER_MODEL_NAME,
    );
    const groupId = new mongoose.Types.ObjectId();
    await model.create({
      groupId,
      userId: new mongoose.Types.ObjectId(),
      role: 'owner',
      joinedAt: now,
    });

    const error = await writeError(
      model.create({
        groupId,
        userId: new mongoose.Types.ObjectId(),
        role: 'owner',
        joinedAt: now,
      }),
    );

    expect(duplicateKeyIs(error, OWNER_KEY)).toBe(true);
    // Comparte el campo `groupId` con el de membresía, pero no es él: el `keyPattern` completo los distingue.
    expect(duplicateKeyIs(error, MEMBERSHIP_KEY)).toBe(false);
    expect(
      await connection
        .collection(GROUP_MEMBERS_COLLECTION)
        .countDocuments({ groupId, role: 'owner' }),
    ).toBe(1);
  });

  it('accepts many members and one owner in each group', async () => {
    const model = connection.model<GroupMemberDocument>(
      GROUP_MEMBER_MODEL_NAME,
    );
    const first = new mongoose.Types.ObjectId();
    const second = new mongoose.Types.ObjectId();

    await expect(
      model.insertMany([
        { groupId: first, userId: USER_ID, role: 'owner', joinedAt: now },
        {
          groupId: first,
          userId: new mongoose.Types.ObjectId(),
          role: 'member',
          joinedAt: now,
        },
        {
          groupId: first,
          userId: new mongoose.Types.ObjectId(),
          role: 'member',
          joinedAt: now,
        },
        { groupId: second, userId: USER_ID, role: 'owner', joinedAt: now },
      ]),
    ).resolves.toHaveLength(4);
  });
});

describe('duplicateKeyIs', () => {
  it('recognizes the membership index by its whole key pattern', async () => {
    const model = connection.model<GroupMemberDocument>(
      GROUP_MEMBER_MODEL_NAME,
    );
    const groupId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();
    await model.create({ groupId, userId, role: 'member', joinedAt: now });

    const error = await writeError(
      model.create({ groupId, userId, role: 'member', joinedAt: now }),
    );

    expect(duplicateKeyIs(error, MEMBERSHIP_KEY)).toBe(true);
    expect(duplicateKeyIs(error, OWNER_KEY)).toBe(false);
    expect(duplicateKeyIs(error, INVITE_KEY)).toBe(false);
  });

  it('recognizes the invite code index', async () => {
    const model = connection.model<GroupDocument>(GROUP_MODEL_NAME);
    const code = 'Q2R3S4T5';
    await model.create({
      name: 'Uno',
      inviteCode: code,
      createdAt: now,
      updatedAt: now,
    });

    const error = await writeError(
      model.create({
        name: 'Dos',
        inviteCode: code,
        createdAt: now,
        updatedAt: now,
      }),
    );

    expect(duplicateKeyIs(error, INVITE_KEY)).toBe(true);
    expect(duplicateKeyIs(error, OWNER_KEY)).toBe(false);
  });

});

describe('format guard', () => {
  it('turns a well formed id into an ObjectId', () => {
    const groupId = GROUP_ID.toHexString();

    expect(toGroupObjectId(groupId)?.toHexString()).toBe(groupId);
    expect(toUserObjectId(groupId)?.toHexString()).toBe(groupId);
  });

  it.each(['no-es-un-id', '', 'twelve-bytes', `${GROUP_ID.toHexString()} `])(
    'returns null for %j without throwing',
    (id) => {
      expect(toGroupObjectId(id)).toBeNull();
      expect(toUserObjectId(id)).toBeNull();
    },
  );

  it('is what keeps a CastError away: Mongo only sees well formed ids', async () => {
    // Sin la guarda, `findById('no-es-un-id')` lanzaría un CastError y saldría un 500 en lugar del 404 uniforme.
    await expect(
      connection
        .model<GroupDocument>(GROUP_MODEL_NAME)
        .findById(new mongoose.Types.ObjectId())
        .lean()
        .exec(),
    ).resolves.toBeNull();
    await expect(
      connection
        .model<GroupDocument>(GROUP_MODEL_NAME)
        .findById('no-es-un-id')
        .lean()
        .exec(),
    ).rejects.toBeInstanceOf(mongoose.Error.CastError);
  });
});
