import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GroupNotFound,
  MemberNotFound,
  OwnerCannotLeave,
  OwnerRoleRequired,
} from '../domain/errors';
import type { Group } from '../domain/group';
import { CreateGroup } from './create-group.usecase';
import { JoinByCode } from './join-by-code.usecase';
import { ListMyGroups } from './list-my-groups.usecase';
import { RemoveMember } from './remove-member.usecase';
import {
  MovableClock,
  StubInviteCodeGenerator,
} from './testing/groups-test-doubles';
import { InMemoryGroupRepository } from './testing/in-memory-group.repository';

const ANA = '66e9a0000000000000000001';
const BETO = '66e9a0000000000000000002';
const CARLA = '66e9a0000000000000000003';
const DIEGO = '66e9a0000000000000000004';

let clock: MovableClock;
let repository: InMemoryGroupRepository;
let removeMember: RemoveMember;
let listMyGroups: ListMyGroups;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  removeMember = new RemoveMember(repository);
  listMyGroups = new ListMyGroups(repository);
});

/** Grupo de Ana (owner) con Beto y Carla dentro, tal y como está guardado. */
async function groupOfAnaWithTwo(): Promise<Group> {
  const detail = await new CreateGroup(repository, clock).execute(ANA, 'Grupo');
  for (const userId of [BETO, CARLA]) {
    await repository.addMember({
      groupId: detail.id,
      userId,
      now: clock.now(),
    });
  }
  const group = await repository.findById(detail.id);
  if (group === null) {
    throw new Error('The group was just created');
  }
  return group;
}

describe('RemoveMember', () => {
  it('El owner expulsa', async () => {
    const group = await groupOfAnaWithTwo();

    await expect(
      removeMember.execute(ANA, group.id, BETO),
    ).resolves.toBeUndefined();

    await expect(listMyGroups.execute(BETO)).resolves.toEqual([]);
    await expect(repository.listMembers(group.id)).resolves.toHaveLength(2);
    // Con el código vigente puede volver a entrar: por eso la UI ofrece regenerarlo.
    await expect(
      new JoinByCode(repository, clock).execute(BETO, group.inviteCode),
    ).resolves.toMatchObject({ id: group.id, role: 'member' });
  });

  it('Un miembro no puede expulsar', async () => {
    const group = await groupOfAnaWithTwo();

    await expect(
      removeMember.execute(BETO, group.id, CARLA),
    ).rejects.toBeInstanceOf(OwnerRoleRequired);

    await expect(repository.listMembers(group.id)).resolves.toHaveLength(3);
  });

  it('Expulsar a quien no es miembro', async () => {
    const group = await groupOfAnaWithTwo();

    await expect(
      removeMember.execute(ANA, group.id, DIEGO),
    ).rejects.toBeInstanceOf(MemberNotFound);
    await expect(
      removeMember.execute(ANA, group.id, 'no-es-un-id'),
    ).rejects.toBeInstanceOf(MemberNotFound);
  });

  it('never removes the owner membership, not even on request of the owner', async () => {
    const group = await groupOfAnaWithTwo();

    await expect(
      removeMember.execute(ANA, group.id, ANA),
    ).rejects.toBeInstanceOf(OwnerCannotLeave);

    await expect(
      repository.findMembership(group.id, ANA),
    ).resolves.toMatchObject({ role: 'owner' });
  });

  it('answers GroupNotFound to a stranger and to an unknown group', async () => {
    const group = await groupOfAnaWithTwo();

    await expect(
      removeMember.execute(DIEGO, group.id, BETO),
    ).rejects.toBeInstanceOf(GroupNotFound);
    await expect(
      removeMember.execute(ANA, '66e9a00000000000000000ff', BETO),
    ).rejects.toBeInstanceOf(GroupNotFound);
  });
});

describe('RemoveMember when the role changes between the read and the write', () => {
  it('Expulsar a quien acaba de recibir la propiedad', async () => {
    const group = await groupOfAnaWithTwo();
    // Ana leyó a Beto como `member`, pero entre medias le cedió la propiedad: quien expulsaba ya no es owner.
    vi.spyOn(repository, 'removeMember').mockResolvedValueOnce('now_owner');

    await expect(
      removeMember.execute(ANA, group.id, BETO),
    ).rejects.toBeInstanceOf(OwnerRoleRequired);
  });

  it('answers MemberNotFound when the membership was already gone', async () => {
    const group = await groupOfAnaWithTwo();
    vi.spyOn(repository, 'removeMember').mockResolvedValueOnce('not_member');

    await expect(
      removeMember.execute(ANA, group.id, BETO),
    ).rejects.toBeInstanceOf(MemberNotFound);
  });
});
