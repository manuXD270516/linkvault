import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupNotFound, OwnerCannotLeave } from '../domain/errors';
import { CreateGroup } from './create-group.usecase';
import { LeaveGroup } from './leave-group.usecase';
import { ListMyGroups } from './list-my-groups.usecase';
import {
  MovableClock,
  StubInviteCodeGenerator,
} from './testing/groups-test-doubles';
import { InMemoryGroupRepository } from './testing/in-memory-group.repository';

const ANA = '66e9a0000000000000000001';
const BETO = '66e9a0000000000000000002';
const CARLA = '66e9a0000000000000000003';
const ORPHAN_GROUP = '66e9a00000000000000000ff';

let clock: MovableClock;
let repository: InMemoryGroupRepository;
let leaveGroup: LeaveGroup;
let listMyGroups: ListMyGroups;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  leaveGroup = new LeaveGroup(repository);
  listMyGroups = new ListMyGroups(repository);
});

async function groupOfAnaWithBeto() {
  const group = await new CreateGroup(repository, clock).execute(ANA, 'Grupo');
  await repository.addMember({
    groupId: group.id,
    userId: BETO,
    now: clock.now(),
  });
  return group;
}

describe('LeaveGroup', () => {
  it('Un miembro sale', async () => {
    const group = await groupOfAnaWithBeto();

    await expect(leaveGroup.execute(BETO, group.id)).resolves.toBeUndefined();

    await expect(listMyGroups.execute(BETO)).resolves.toEqual([]);
    await expect(repository.listMembers(group.id)).resolves.toHaveLength(1);
  });

  it('El owner no puede salir', async () => {
    const group = await groupOfAnaWithBeto();

    await expect(leaveGroup.execute(ANA, group.id)).rejects.toBeInstanceOf(
      OwnerCannotLeave,
    );

    await expect(
      repository.findMembership(group.id, ANA),
    ).resolves.toMatchObject({ role: 'owner' });
    await expect(listMyGroups.execute(ANA)).resolves.toHaveLength(1);
  });

  it('answers GroupNotFound to a stranger, an unknown group and a malformed id', async () => {
    const group = await groupOfAnaWithBeto();

    await expect(leaveGroup.execute(CARLA, group.id)).rejects.toBeInstanceOf(
      GroupNotFound,
    );
    await expect(leaveGroup.execute(ANA, ORPHAN_GROUP)).rejects.toBeInstanceOf(
      GroupNotFound,
    );
    await expect(leaveGroup.execute(ANA, 'no-es-un-id')).rejects.toBeInstanceOf(
      GroupNotFound,
    );
  });

  it('releases an orphan membership and frees its slot', async () => {
    await repository.addMember({
      groupId: ORPHAN_GROUP,
      userId: BETO,
      now: clock.now(),
    });

    await expect(
      leaveGroup.execute(BETO, ORPHAN_GROUP),
    ).resolves.toBeUndefined();

    await expect(
      repository.findMembership(ORPHAN_GROUP, BETO),
    ).resolves.toBeNull();
    await expect(repository.countGroupsOfUser(BETO)).resolves.toBe(0);
  });

  it('is not idempotent: leaving twice answers GroupNotFound', async () => {
    const group = await groupOfAnaWithBeto();
    await leaveGroup.execute(BETO, group.id);

    await expect(leaveGroup.execute(BETO, group.id)).rejects.toBeInstanceOf(
      GroupNotFound,
    );
  });
});

describe('LeaveGroup when the role changes between the read and the write', () => {
  it('Salir justo después de recibir la propiedad', async () => {
    const group = await groupOfAnaWithBeto();
    // Beto se leyó como `member`, pero al escribir ya es `owner`: el repositorio no borra y dice `now_owner`.
    vi.spyOn(repository, 'removeMember').mockResolvedValueOnce('now_owner');

    await expect(leaveGroup.execute(BETO, group.id)).rejects.toBeInstanceOf(
      OwnerCannotLeave,
    );
  });

  it('answers GroupNotFound when the membership was already gone', async () => {
    const group = await groupOfAnaWithBeto();
    vi.spyOn(repository, 'removeMember').mockResolvedValueOnce('not_member');

    await expect(leaveGroup.execute(BETO, group.id)).rejects.toBeInstanceOf(
      GroupNotFound,
    );
  });
});
