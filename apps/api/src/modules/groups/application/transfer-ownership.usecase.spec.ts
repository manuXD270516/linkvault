import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AlreadyOwner,
  GroupNotFound,
  MemberNotFound,
  OwnerRoleRequired,
} from '../domain/errors';
import { CreateGroup } from './create-group.usecase';
import { GetGroup } from './get-group.usecase';
import { ListMembers } from './list-members.usecase';
import {
  InMemoryMemberDirectory,
  MovableClock,
  StubInviteCodeGenerator,
} from './testing/groups-test-doubles';
import { InMemoryGroupRepository } from './testing/in-memory-group.repository';
import { TransferOwnership } from './transfer-ownership.usecase';

const ANA = '66e9a0000000000000000001';
const BETO = '66e9a0000000000000000002';
const CARLA = '66e9a0000000000000000003';
const DIEGO = '66e9a0000000000000000004';
const UNKNOWN_GROUP = '66e9a00000000000000000ff';
const MALFORMED = 'no-es-un-id';

let clock: MovableClock;
let repository: InMemoryGroupRepository;
let transfer: TransferOwnership;
let listMembers: ListMembers;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  transfer = new TransferOwnership(repository);
  listMembers = new ListMembers(
    repository,
    new InMemoryMemberDirectory()
      .set(ANA, 'Ana')
      .set(BETO, 'Beto')
      .set(CARLA, 'Carla'),
  );
});

/** Grupo de Ana con Beto y Carla, que entran un día después cada uno. */
async function groupOfAnaWithBetoAndCarla() {
  const group = await new CreateGroup(repository, clock).execute(
    ANA,
    'Backend Bolivia',
  );
  clock.advance(86_400_000);
  await repository.addMember({
    groupId: group.id,
    userId: BETO,
    now: clock.now(),
  });
  clock.advance(86_400_000);
  await repository.addMember({
    groupId: group.id,
    userId: CARLA,
    now: clock.now(),
  });
  return group;
}

async function rolesOf(groupId: string): Promise<[string, string, string][]> {
  // Ana sigue siendo miembro en todos los casos, así que puede listar.
  const members = await listMembers.execute(ANA, groupId);
  return members.map((member) => [
    member.displayName,
    member.role,
    member.joinedAt,
  ]);
}

describe('TransferOwnership', () => {
  it('El owner nombra a otro', async () => {
    const group = await groupOfAnaWithBetoAndCarla();

    const detail = await transfer.execute(ANA, group.id, BETO);

    // Quien pide ya es `member`: el detalle no lleva el código de invitación.
    expect(detail).toEqual({
      id: group.id,
      name: 'Backend Bolivia',
      role: 'member',
      memberCount: 3,
      createdAt: '2026-09-17T10:00:00.000Z',
    });
    await expect(rolesOf(group.id)).resolves.toEqual([
      ['Ana', 'member', '2026-09-17T10:00:00.000Z'],
      ['Beto', 'owner', '2026-09-18T10:00:00.000Z'],
      ['Carla', 'member', '2026-09-19T10:00:00.000Z'],
    ]);
    // El código de invitación no cambia, y ahora es Beto quien lo ve.
    await expect(
      new GetGroup(repository).execute(BETO, group.id),
    ).resolves.toMatchObject({ role: 'owner', inviteCode: group.inviteCode });
  });

  it('Un miembro no puede transferir', async () => {
    const group = await groupOfAnaWithBetoAndCarla();

    await expect(
      transfer.execute(BETO, group.id, CARLA),
    ).rejects.toBeInstanceOf(OwnerRoleRequired);

    await expect(rolesOf(group.id)).resolves.toEqual([
      ['Ana', 'owner', '2026-09-17T10:00:00.000Z'],
      ['Beto', 'member', '2026-09-18T10:00:00.000Z'],
      ['Carla', 'member', '2026-09-19T10:00:00.000Z'],
    ]);
  });

  it.each([
    ['someone who is not a member', DIEGO],
    ['a malformed user id', MALFORMED],
  ])('Transferir a quien no es miembro: %s', async (_case, target) => {
    const group = await groupOfAnaWithBetoAndCarla();

    await expect(
      transfer.execute(ANA, group.id, target),
    ).rejects.toBeInstanceOf(MemberNotFound);

    await expect(
      repository.findMembership(group.id, ANA),
    ).resolves.toMatchObject({ role: 'owner' });
  });

  it('Transferirse a sí mismo', async () => {
    const group = await groupOfAnaWithBetoAndCarla();
    const writes = vi.spyOn(repository, 'transferOwnership');

    await expect(transfer.execute(ANA, group.id, ANA)).rejects.toBeInstanceOf(
      AlreadyOwner,
    );

    expect(writes).not.toHaveBeenCalled();
    await expect(
      repository.findMembership(group.id, ANA),
    ).resolves.toMatchObject({ role: 'owner' });
  });

  it('answers GroupNotFound to a stranger, an unknown group and a malformed id', async () => {
    const group = await groupOfAnaWithBetoAndCarla();

    for (const [userId, groupId] of [
      [DIEGO, group.id],
      [ANA, UNKNOWN_GROUP],
      [ANA, MALFORMED],
    ] as const) {
      await expect(
        transfer.execute(userId, groupId, BETO),
      ).rejects.toBeInstanceOf(GroupNotFound);
    }
  });

  it('checks the errors in the order of D1: forbidden before already_owner and member_not_found', async () => {
    const group = await groupOfAnaWithBetoAndCarla();

    // Beto no es owner: aunque se nombre a sí mismo o a un extraño, recibe `forbidden`.
    await expect(transfer.execute(BETO, group.id, BETO)).rejects.toBeInstanceOf(
      OwnerRoleRequired,
    );
    await expect(
      transfer.execute(BETO, group.id, DIEGO),
    ).rejects.toBeInstanceOf(OwnerRoleRequired);
  });

  it('answers forbidden when the requester stopped being the owner before writing', async () => {
    const group = await groupOfAnaWithBetoAndCarla();
    // Otra pestaña ya transfirió: el repositorio, que condiciona por rol al escribir, dice `not_owner`.
    vi.spyOn(repository, 'transferOwnership').mockResolvedValueOnce(
      'not_owner',
    );

    await expect(transfer.execute(ANA, group.id, CARLA)).rejects.toBeInstanceOf(
      OwnerRoleRequired,
    );
  });
});
