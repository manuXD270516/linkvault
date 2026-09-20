import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  InviteCodeUnavailable,
  MAX_INVITE_CODE_ATTEMPTS,
} from '../application/ports/invite-code-generator.port';
import { StubInviteCodeGenerator } from '../application/testing/groups-test-doubles';
import { isValidInviteCode } from '../domain/invite-code';
import {
  GROUP_MEMBER_MODEL_NAME,
  GROUP_MEMBERS_COLLECTION,
  GROUP_MODEL_NAME,
  GROUPS_COLLECTION,
  type GroupMemberDocument,
} from './group.schemas';
import { GroupDeletionHooks } from '../application/group-deletion-hooks';
import { MongoGroupRepository } from './mongo-group.repository';

// Adaptador Mongo del puerto GROUP_REPOSITORY, altas y lecturas (tarea 3.3 de groups), contra el MongoMemoryReplSet del
// preset de @linkvault/testing: la transacción del alta necesita el replica set.

let connection: Connection;
let generator: StubInviteCodeGenerator;
let repository: MongoGroupRepository;

const now = new Date('2026-09-17T10:00:00.000Z');
const later = new Date('2026-09-18T12:00:00.000Z');
const OWNER = new mongoose.Types.ObjectId().toHexString();
const MEMBER = new mongoose.Types.ObjectId().toHexString();
const STRANGER = new mongoose.Types.ObjectId().toHexString();
const MALFORMED = 'no-es-un-id';
/** Códigos con el formato del dominio que ningún grupo de este archivo usa antes de pedirlos. */
const FREE_CODE = 'ZW2X3Y4V';
const ANOTHER_FREE_CODE = 'VW2X3Y4Z';

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `groups-${randomUUID()}` })
    .asPromise();
  generator = new StubInviteCodeGenerator();
  repository = new MongoGroupRepository(
    connection,
    generator,
    new GroupDeletionHooks(),
  );
  await connection.model(GROUP_MODEL_NAME).init();
  await connection.model(GROUP_MEMBER_MODEL_NAME).init();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

function createGroupOf(ownerId: string, name = 'Backend Bolivia') {
  return repository.create({ name, ownerId, now });
}

function newUserId(): string {
  return new mongoose.Types.ObjectId().toHexString();
}

/** Repositorio con su propio registro de hooks, para que lo que registre un test no afecte a los demás. */
function withHooks(): {
  hooks: GroupDeletionHooks;
  repository: MongoGroupRepository;
} {
  const hooks = new GroupDeletionHooks();
  return {
    hooks,
    repository: new MongoGroupRepository(connection, generator, hooks),
  };
}

/** Borra solo el documento del grupo, como haría un borrado que corre a la vez que un `join`: deja huérfana la membresía. */
async function dropGroupDocument(groupId: string): Promise<void> {
  await connection
    .collection(GROUPS_COLLECTION)
    .deleteOne({ _id: new mongoose.Types.ObjectId(groupId) });
}

describe('create', () => {
  it('stores the group and the owner membership in one go', async () => {
    const group = await createGroupOf(OWNER);

    expect(group).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      name: 'Backend Bolivia',
      inviteCode: expect.stringMatching(/^[0-9A-Z]{8}$/),
      defaultVisibility: 'public',
      createdAt: now,
      updatedAt: now,
    });
    await expect(repository.findMembership(group.id, OWNER)).resolves.toEqual({
      groupId: group.id,
      userId: OWNER,
      role: 'owner',
      joinedAt: now,
    });
  });

  it('stores no owner in the group document', async () => {
    const group = await createGroupOf(OWNER, 'Sin owner en el documento');

    const raw = await connection
      .collection(GROUPS_COLLECTION)
      .findOne({ _id: new mongoose.Types.ObjectId(group.id) });

    expect(raw).toEqual({
      _id: new mongoose.Types.ObjectId(group.id),
      name: 'Sin owner en el documento',
      inviteCode: group.inviteCode,
      createdAt: now,
      updatedAt: now,
    });
  });

  it('Nombres repetidos', async () => {
    const first = await createGroupOf(OWNER, 'Repetido');
    const second = await createGroupOf(OWNER, 'Repetido');

    expect(second.id).not.toBe(first.id);
    expect(second.inviteCode).not.toBe(first.inviteCode);
  });

  it('Grupo sin owner imposible', async () => {
    const members = connection.model<GroupMemberDocument>(
      GROUP_MEMBER_MODEL_NAME,
    );
    vi.spyOn(members, 'create').mockRejectedValueOnce(
      new Error('membership write failed'),
    );

    await expect(createGroupOf(OWNER, 'Sin owner')).rejects.toThrow(
      'membership write failed',
    );

    await expect(
      connection
        .collection(GROUPS_COLLECTION)
        .countDocuments({ name: 'Sin owner' }),
    ).resolves.toBe(0);
  });

  it('rejects an owner id that is not an identifier', async () => {
    await expect(
      repository.create({ name: 'Malo', ownerId: MALFORMED, now }),
    ).rejects.toThrow();
  });
});

describe('lookups', () => {
  it('finds a group by id and by invite code', async () => {
    const group = await createGroupOf(OWNER, 'Buscado');

    await expect(repository.findById(group.id)).resolves.toEqual(group);
    await expect(
      repository.findByInviteCode(group.inviteCode),
    ).resolves.toEqual(group);
  });

  it.each([
    ['an unknown id', new mongoose.Types.ObjectId().toHexString()],
    ['a malformed id', MALFORMED],
    ['a 12 byte string', 'twelve-bytes'],
  ])('returns null for %s, without throwing', async (_case, groupId) => {
    await expect(repository.findById(groupId)).resolves.toBeNull();
  });

  it('returns null for an unknown invite code', async () => {
    await expect(repository.findByInviteCode('A2B3C4D5')).resolves.toBeNull();
  });

  it('returns null for the membership of a stranger or a malformed id', async () => {
    const group = await createGroupOf(OWNER, 'Membresías');

    await expect(
      repository.findMembership(group.id, STRANGER),
    ).resolves.toBeNull();
    await expect(
      repository.findMembership(group.id, MALFORMED),
    ).resolves.toBeNull();
    await expect(
      repository.findMembership(MALFORMED, OWNER),
    ).resolves.toBeNull();
  });
});

describe('members', () => {
  it('adds a member and does not duplicate an existing membership', async () => {
    const group = await createGroupOf(OWNER, 'Miembros');

    const added = await repository.addMember({
      groupId: group.id,
      userId: MEMBER,
      now: later,
    });
    const again = await repository.addMember({
      groupId: group.id,
      userId: MEMBER,
      now: new Date('2026-09-19T12:00:00.000Z'),
    });

    expect(added).toEqual({
      groupId: group.id,
      userId: MEMBER,
      role: 'member',
      joinedAt: later,
    });
    expect(again).toEqual(added);
    await expect(
      connection
        .collection(GROUP_MEMBERS_COLLECTION)
        .countDocuments({ userId: new mongoose.Types.ObjectId(MEMBER) }),
    ).resolves.toBe(1);
  });

  it('does not take a violation of the owner index for an existing membership', async () => {
    const group = await createGroupOf(OWNER, 'Índice de owner');
    await repository.addMember({
      groupId: group.id,
      userId: MEMBER,
      now: later,
    });
    // Un 11000 real del índice `one_owner_per_group`: una segunda membresía `owner` en el mismo grupo.
    let ownerViolation: unknown;
    try {
      await connection.collection(GROUP_MEMBERS_COLLECTION).insertOne({
        groupId: new mongoose.Types.ObjectId(group.id),
        userId: new mongoose.Types.ObjectId(),
        role: 'owner',
        joinedAt: later,
      });
    } catch (error) {
      ownerViolation = error;
    }
    expect(ownerViolation).toBeInstanceOf(mongoose.mongo.MongoServerError);
    const members = connection.model<GroupMemberDocument>(
      GROUP_MEMBER_MODEL_NAME,
    );
    vi.spyOn(members, 'create').mockRejectedValueOnce(ownerViolation);

    // `MEMBER` ya es miembro: con "el keyPattern incluye groupId" se habría devuelto su membresía como si nada.
    await expect(
      repository.addMember({ groupId: group.id, userId: MEMBER, now: later }),
    ).rejects.toBe(ownerViolation);
  });

  it('lists the members by joinedAt ascending, the owner first', async () => {
    const group = await createGroupOf(OWNER, 'Orden de miembros');
    await repository.addMember({
      groupId: group.id,
      userId: STRANGER,
      now: new Date('2026-09-20T10:00:00.000Z'),
    });
    await repository.addMember({
      groupId: group.id,
      userId: MEMBER,
      now: later,
    });

    const members = await repository.listMembers(group.id);

    expect(members.map((member) => member.userId)).toEqual([
      OWNER,
      MEMBER,
      STRANGER,
    ]);
    expect(members.map((member) => member.role)).toEqual([
      'owner',
      'member',
      'member',
    ]);
  });

  it('returns an empty list of members for a malformed group id', async () => {
    await expect(repository.listMembers(MALFORMED)).resolves.toEqual([]);
  });

  it('counts the members of several groups with one aggregation', async () => {
    const first = await createGroupOf(OWNER, 'Conteo uno');
    const second = await createGroupOf(OWNER, 'Conteo dos');
    await repository.addMember({
      groupId: first.id,
      userId: MEMBER,
      now: later,
    });
    const aggregate = vi.spyOn(
      connection.model<GroupMemberDocument>(GROUP_MEMBER_MODEL_NAME),
      'aggregate',
    );

    const counts = await repository.countMembers([
      first.id,
      second.id,
      MALFORMED,
    ]);

    expect(counts.get(first.id)).toBe(2);
    expect(counts.get(second.id)).toBe(1);
    expect(counts.has(MALFORMED)).toBe(false);
    expect(aggregate).toHaveBeenCalledTimes(1);
  });

  it('returns an empty map when no id has the right format', async () => {
    await expect(repository.countMembers([MALFORMED])).resolves.toEqual(
      new Map(),
    );
  });
});

describe('groups of a user', () => {
  it('lists them by joinedAt descending with the role of each membership', async () => {
    const owner = new mongoose.Types.ObjectId().toHexString();
    const own = await repository.create({
      name: 'Propio',
      ownerId: owner,
      now,
    });
    const other = await createGroupOf(STRANGER, 'Ajeno');
    await repository.addMember({
      groupId: other.id,
      userId: owner,
      now: later,
    });

    const groups = await repository.listGroupsOfUser(owner);

    expect(
      groups.map((entry) => [entry.group.id, entry.role, entry.joinedAt]),
    ).toEqual([
      [other.id, 'member', later],
      [own.id, 'owner', now],
    ]);
  });

  it('answers an empty list for a user without groups and for a malformed id', async () => {
    await expect(
      repository.listGroupsOfUser(new mongoose.Types.ObjectId().toHexString()),
    ).resolves.toEqual([]);
    await expect(repository.listGroupsOfUser(MALFORMED)).resolves.toEqual([]);
  });
});

describe('the invite code', () => {
  it('is asked to the generator and comes out with the format of the domain', async () => {
    const before = generator.calls;

    const group = await createGroupOf(OWNER, 'Código del generador');

    expect(generator.calls).toBe(before + 1);
    expect(isValidInviteCode(group.inviteCode)).toBe(true);
  });

  it('is different for every group', async () => {
    const codes = new Set<string>();
    for (let index = 0; index < 3; index += 1) {
      const group = await createGroupOf(OWNER, `Códigos ${index}`);
      codes.add(group.inviteCode);
    }

    expect(codes.size).toBe(3);
  });
});

// Tarea 3.4: borrado, membresías huérfanas y códigos.

describe('rename and rotate', () => {
  it('renames the group and moves updatedAt', async () => {
    const group = await createGroupOf(OWNER, 'Nombre viejo');

    const renamed = await repository.rename(group.id, 'Backend LatAm', later);

    expect(renamed).toEqual({
      ...group,
      name: 'Backend LatAm',
      updatedAt: later,
    });
    await expect(repository.findById(group.id)).resolves.toEqual(renamed);
  });

  it('Regenerar el código', async () => {
    const group = await createGroupOf(OWNER, 'Rotación');

    const rotated = await repository.rotateInviteCode(group.id, later);

    expect(rotated?.inviteCode).not.toBe(group.inviteCode);
    expect(rotated?.updatedAt).toEqual(later);
    await expect(
      repository.findByInviteCode(group.inviteCode),
    ).resolves.toBeNull();
    await expect(
      repository.findByInviteCode(rotated?.inviteCode ?? ''),
    ).resolves.toEqual(rotated);
  });

  it.each([
    ['an unknown group', new mongoose.Types.ObjectId().toHexString()],
    ['a malformed id', MALFORMED],
  ])('returns null when renaming or rotating %s', async (_case, groupId) => {
    await expect(repository.rename(groupId, 'Otro', later)).resolves.toBeNull();
    await expect(
      repository.rotateInviteCode(groupId, later),
    ).resolves.toBeNull();
  });
});

describe('updateSettings', () => {
  it('escribe la visibilidad por defecto y la relee', async () => {
    const group = await createGroupOf(OWNER, 'Con ajuste');
    expect(group.defaultVisibility).toBe('public');

    const updated = await repository.updateSettings(group.id, 'private', later);

    expect(updated).toEqual({
      ...group,
      defaultVisibility: 'private',
      updatedAt: later,
    });
    await expect(repository.findById(group.id)).resolves.toEqual(updated);
  });

  it('lee como público un documento guardado sin settings', async () => {
    const group = await createGroupOf(OWNER, 'Anterior al ajuste');
    await connection
      .collection(GROUPS_COLLECTION)
      .updateOne(
        { _id: new mongoose.Types.ObjectId(group.id) },
        { $unset: { settings: 1 } },
      );

    await expect(repository.findById(group.id)).resolves.toMatchObject({
      defaultVisibility: 'public',
    });
  });

  it('no toca el nombre ni el código al cambiar el ajuste', async () => {
    const group = await createGroupOf(OWNER, 'Solo el ajuste');

    const updated = await repository.updateSettings(group.id, 'private', later);

    expect(updated?.name).toBe(group.name);
    expect(updated?.inviteCode).toBe(group.inviteCode);
    expect(updated?.createdAt).toEqual(group.createdAt);
  });

  it.each([
    ['un grupo que no existe', new mongoose.Types.ObjectId().toHexString()],
    ['un identificador mal formado', MALFORMED],
  ])('devuelve null con %s', async (_case, groupId) => {
    await expect(
      repository.updateSettings(groupId, 'private', later),
    ).resolves.toBeNull();
  });
});

describe('a generator that repeats a taken code', () => {
  it('ends up with a free one when creating', async () => {
    const taken = await createGroupOf(OWNER, 'Ocupa el código');
    const repeated = new StubInviteCodeGenerator([taken.inviteCode, FREE_CODE]);

    const group = await new MongoGroupRepository(
      connection,
      repeated,
      new GroupDeletionHooks(),
    ).create({
      name: 'Reintenta al crear',
      ownerId: OWNER,
      now,
    });

    expect(group.inviteCode).toBe(FREE_CODE);
    expect(repeated.calls).toBe(2);
    await expect(
      repository.findMembership(group.id, OWNER),
    ).resolves.not.toBeNull();
  });

  it('ends up with a free one when rotating', async () => {
    const taken = await createGroupOf(OWNER, 'Ocupa el código al rotar');
    const group = await createGroupOf(OWNER, 'Rota con colisión');
    const repeated = new StubInviteCodeGenerator([
      taken.inviteCode,
      ANOTHER_FREE_CODE,
    ]);

    const rotated = await new MongoGroupRepository(
      connection,
      repeated,
      new GroupDeletionHooks(),
    ).rotateInviteCode(group.id, later);

    expect(rotated?.inviteCode).toBe(ANOTHER_FREE_CODE);
    expect(repeated.calls).toBe(2);
  });

  it('gives up after 5 attempts without leaving a group behind', async () => {
    const taken = await createGroupOf(OWNER, 'Siempre ocupado');
    const always = new StubInviteCodeGenerator(
      Array.from({ length: MAX_INVITE_CODE_ATTEMPTS }, () => taken.inviteCode),
    );

    await expect(
      new MongoGroupRepository(
        connection,
        always,
        new GroupDeletionHooks(),
      ).create({
        name: 'Nunca creado',
        ownerId: OWNER,
        now,
      }),
    ).rejects.toBeInstanceOf(InviteCodeUnavailable);

    expect(always.calls).toBe(MAX_INVITE_CODE_ATTEMPTS);
    await expect(
      connection
        .collection(GROUPS_COLLECTION)
        .countDocuments({ name: 'Nunca creado' }),
    ).resolves.toBe(0);
  });
});

describe('delete', () => {
  it('El owner borra el grupo', async () => {
    const user = newUserId();
    const group = await createGroupOf(OWNER, 'Para borrar');
    await repository.addMember({
      groupId: group.id,
      userId: user,
      now: later,
    });

    await expect(repository.deleteGroup(group.id, OWNER)).resolves.toBe(
      'deleted',
    );

    await expect(repository.findById(group.id)).resolves.toBeNull();
    await expect(
      repository.findByInviteCode(group.inviteCode),
    ).resolves.toBeNull();
    await expect(
      connection
        .collection(GROUP_MEMBERS_COLLECTION)
        .countDocuments({ groupId: new mongoose.Types.ObjectId(group.id) }),
    ).resolves.toBe(0);
    await expect(repository.listGroupsOfUser(user)).resolves.toEqual([]);
  });

  it.each([
    ['an unknown group', new mongoose.Types.ObjectId().toHexString()],
    ['a malformed id', MALFORMED],
  ])('reports not_found when deleting %s', async (_case, groupId) => {
    await expect(repository.deleteGroup(groupId, OWNER)).resolves.toBe(
      'not_found',
    );
  });

  it.each([
    ['a member', 'member'],
    ['a stranger', 'stranger'],
    ['a malformed user id', 'malformed'],
  ] as const)(
    'answers not_owner without deleting anything or running hooks when %s asks',
    async (_case, who) => {
      let runs = 0;
      const { hooks, repository } = withHooks();
      hooks.register({
        deleteRelationsOf: () => {
          runs += 1;
          return Promise.resolve();
        },
      });
      const user = newUserId();
      const group = await createGroupOf(OWNER, 'Borrado ajeno');
      await repository.addMember({
        groupId: group.id,
        userId: user,
        now: later,
      });
      const asking =
        who === 'member' ? user : who === 'stranger' ? STRANGER : MALFORMED;

      await expect(repository.deleteGroup(group.id, asking)).resolves.toBe(
        'not_owner',
      );

      expect(runs).toBe(0);
      await expect(repository.findById(group.id)).resolves.not.toBeNull();
      await expect(repository.listMembers(group.id)).resolves.toHaveLength(2);
    },
  );

  it('answers not_owner to the former owner after a transfer, and the new owner can delete', async () => {
    const user = newUserId();
    const group = await createGroupOf(OWNER, 'Borrado tras transferir');
    await repository.addMember({ groupId: group.id, userId: user, now: later });
    await repository.transferOwnership(group.id, OWNER, user);

    await expect(repository.deleteGroup(group.id, OWNER)).resolves.toBe(
      'not_owner',
    );
    await expect(
      repository.findMembership(group.id, user),
    ).resolves.toMatchObject({ role: 'owner' });
    await expect(repository.deleteGroup(group.id, user)).resolves.toBe(
      'deleted',
    );
  });

  it('runs the registered deletion hooks inside the transaction (D7b)', async () => {
    const calls: { groupId: string; session: object }[] = [];
    const { hooks, repository } = withHooks();
    hooks.register({
      deleteRelationsOf: (groupId, session) => {
        calls.push({ groupId, session });
        return Promise.resolve();
      },
    });
    const group = await createGroupOf(OWNER, 'Con hooks');

    await expect(repository.deleteGroup(group.id, OWNER)).resolves.toBe(
      'deleted',
    );

    expect(calls.map((call) => call.groupId)).toEqual([group.id]);
    // La sesión es la de la transacción del borrado: el hook escribe con ella o no escribe nada.
    expect(calls[0]?.session).toBeInstanceOf(mongoose.mongo.ClientSession);
  });

  it('runs no hook when the group was not there (nor when the id is malformed)', async () => {
    let runs = 0;
    const { hooks, repository } = withHooks();
    hooks.register({
      deleteRelationsOf: () => {
        runs += 1;
        return Promise.resolve();
      },
    });

    await expect(
      repository.deleteGroup(
        new mongoose.Types.ObjectId().toHexString(),
        OWNER,
      ),
    ).resolves.toBe('not_found');
    await expect(repository.deleteGroup(MALFORMED, OWNER)).resolves.toBe(
      'not_found',
    );

    expect(runs).toBe(0);
  });

  it('undoes the whole deletion when a hook fails', async () => {
    const { hooks, repository } = withHooks();
    hooks.register({
      deleteRelationsOf: () => Promise.reject(new Error('the hook failed')),
    });
    const group = await createGroupOf(OWNER, 'Hook que falla');

    await expect(repository.deleteGroup(group.id, OWNER)).rejects.toThrow(
      'the hook failed',
    );

    // Ni el grupo ni sus membresías (tampoco la `owner`, la primera en borrarse) se pierden si la limpieza de otro
    // módulo no pudo hacerse.
    await expect(repository.findById(group.id)).resolves.not.toBeNull();
    await expect(
      repository.findMembership(group.id, OWNER),
    ).resolves.toMatchObject({ role: 'owner' });
    await expect(
      connection
        .collection(GROUP_MEMBERS_COLLECTION)
        .countDocuments({ groupId: new mongoose.Types.ObjectId(group.id) }),
    ).resolves.toBe(1);
  });
});

describe('orphan memberships', () => {
  it('Membresía huérfana', async () => {
    const user = newUserId();
    const own = await repository.create({ name: 'Vivo', ownerId: user, now });
    const doomed = await createGroupOf(STRANGER, 'Borrado a la vez');
    await repository.addMember({
      groupId: doomed.id,
      userId: user,
      now: later,
    });

    // Un `join` que corre a la vez que el borrado deja la membresía sin grupo (D6).
    await dropGroupDocument(doomed.id);

    const groups = await repository.listGroupsOfUser(user);

    expect(groups.map((entry) => entry.group.id)).toEqual([own.id]);
    await expect(repository.countGroupsOfUser(user)).resolves.toBe(1);
  });

  it('can still be left, which frees the slot', async () => {
    const user = newUserId();
    const doomed = await createGroupOf(STRANGER, 'Huérfana que se suelta');
    await repository.addMember({
      groupId: doomed.id,
      userId: user,
      now: later,
    });
    await dropGroupDocument(doomed.id);

    await expect(repository.removeMember(doomed.id, user)).resolves.toBe(
      'removed',
    );

    await expect(repository.countGroupsOfUser(user)).resolves.toBe(0);
    await expect(
      connection
        .collection(GROUP_MEMBERS_COLLECTION)
        .countDocuments({ userId: new mongoose.Types.ObjectId(user) }),
    ).resolves.toBe(0);
  });
});

describe('transferOwnership', () => {
  /** Rol de cada miembro, leído de la colección y no del repositorio. */
  async function rolesOf(groupId: string): Promise<Record<string, string>> {
    const rows = await connection
      .collection<GroupMemberDocument>(GROUP_MEMBERS_COLLECTION)
      .find({ groupId: new mongoose.Types.ObjectId(groupId) })
      .toArray();
    return Object.fromEntries(
      rows.map((row) => [row.userId.toHexString(), row.role]),
    );
  }

  it('makes the target the owner and the owner a member, keeping both joinedAt', async () => {
    const user = newUserId();
    const group = await createGroupOf(OWNER, 'Transferencia');
    await repository.addMember({ groupId: group.id, userId: user, now: later });

    await expect(
      repository.transferOwnership(group.id, OWNER, user),
    ).resolves.toBe('transferred');

    await expect(repository.listMembers(group.id)).resolves.toEqual([
      { groupId: group.id, userId: OWNER, role: 'member', joinedAt: now },
      { groupId: group.id, userId: user, role: 'owner', joinedAt: later },
    ]);
  });

  it('answers not_owner without changes when the one asking is not the owner', async () => {
    const user = newUserId();
    const other = newUserId();
    const group = await createGroupOf(OWNER, 'Transferencia ajena');
    await repository.addMember({ groupId: group.id, userId: user, now: later });
    await repository.addMember({
      groupId: group.id,
      userId: other,
      now: later,
    });
    const before = await rolesOf(group.id);

    await expect(
      repository.transferOwnership(group.id, user, other),
    ).resolves.toBe('not_owner');
    await expect(
      repository.transferOwnership(group.id, MALFORMED, other),
    ).resolves.toBe('not_owner');
    await expect(
      repository.transferOwnership(MALFORMED, OWNER, other),
    ).resolves.toBe('not_owner');

    await expect(rolesOf(group.id)).resolves.toEqual(before);
  });

  it('undoes the demotion when the target is not a member, so the group keeps its owner', async () => {
    const group = await createGroupOf(OWNER, 'Destino ausente');
    const members = connection.model<GroupMemberDocument>(
      GROUP_MEMBER_MODEL_NAME,
    );
    const updates = vi.spyOn(members, 'updateOne');

    await expect(
      repository.transferOwnership(group.id, OWNER, STRANGER),
    ).resolves.toBe('target_not_member');

    // Los dos pasos corrieron: el primero degradó al owner dentro de la transacción y el centinela lo deshizo.
    expect(updates).toHaveBeenCalledTimes(2);
    await expect(rolesOf(group.id)).resolves.toEqual({ [OWNER]: 'owner' });
  });

  it('does not promote a member of another group', async () => {
    const user = newUserId();
    const group = await createGroupOf(OWNER, 'Grupo propio');
    const other = await createGroupOf(STRANGER, 'Grupo ajeno');
    await repository.addMember({ groupId: other.id, userId: user, now: later });

    await expect(
      repository.transferOwnership(group.id, OWNER, user),
    ).resolves.toBe('target_not_member');

    await expect(rolesOf(group.id)).resolves.toEqual({ [OWNER]: 'owner' });
    await expect(rolesOf(other.id)).resolves.toEqual({
      [STRANGER]: 'owner',
      [user]: 'member',
    });
  });

  it.each([
    ['a malformed user id', MALFORMED],
    ['the owner himself', OWNER],
  ])('answers target_not_member for %s', async (_case, target) => {
    const group = await createGroupOf(OWNER, 'Destino inválido');

    await expect(
      repository.transferOwnership(group.id, OWNER, target),
    ).resolves.toBe('target_not_member');
    await expect(rolesOf(group.id)).resolves.toEqual({ [OWNER]: 'owner' });
  });
});

describe('removeMember', () => {
  it('removes an existing membership once', async () => {
    const user = newUserId();
    const group = await createGroupOf(OWNER, 'Expulsión');
    await repository.addMember({ groupId: group.id, userId: user, now: later });

    await expect(repository.removeMember(group.id, user)).resolves.toBe(
      'removed',
    );
    await expect(repository.removeMember(group.id, user)).resolves.toBe(
      'not_member',
    );
    await expect(repository.findMembership(group.id, user)).resolves.toBeNull();
  });

  it('does not remove a member who has just become the owner', async () => {
    const user = newUserId();
    const group = await createGroupOf(OWNER, 'Recién propietario');
    await repository.addMember({ groupId: group.id, userId: user, now: later });
    await repository.transferOwnership(group.id, OWNER, user);

    await expect(repository.removeMember(group.id, user)).resolves.toBe(
      'now_owner',
    );

    // No se borró nada: el grupo sigue con sus dos membresías y su owner.
    await expect(repository.listMembers(group.id)).resolves.toEqual([
      { groupId: group.id, userId: OWNER, role: 'member', joinedAt: now },
      { groupId: group.id, userId: user, role: 'owner', joinedAt: later },
    ]);
  });

  it('answers not_member for someone who is not in the group', async () => {
    const group = await createGroupOf(OWNER, 'Sin ese miembro');

    await expect(repository.removeMember(group.id, STRANGER)).resolves.toBe(
      'not_member',
    );
  });

  it('reports not_member for a malformed group id or user id', async () => {
    const group = await createGroupOf(OWNER, 'Expulsión mal formada');

    await expect(repository.removeMember(group.id, MALFORMED)).resolves.toBe(
      'not_member',
    );
    await expect(repository.removeMember(MALFORMED, OWNER)).resolves.toBe(
      'not_member',
    );
  });
});
