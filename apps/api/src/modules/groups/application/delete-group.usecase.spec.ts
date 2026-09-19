import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupNotFound, OwnerRoleRequired } from '../domain/errors';
import type { Group } from '../domain/group';
import { CreateGroup } from './create-group.usecase';
import { DeleteGroup } from './delete-group.usecase';
import { ListMyGroups } from './list-my-groups.usecase';
import { RotateInviteCode } from './rotate-invite-code.usecase';
import {
  MovableClock,
  StubInviteCodeGenerator,
} from './testing/groups-test-doubles';
import { InMemoryGroupRepository } from './testing/in-memory-group.repository';

const ANA = '66e9a0000000000000000001';
const BETO = '66e9a0000000000000000002';
const CARLA = '66e9a0000000000000000003';

let clock: MovableClock;
let repository: InMemoryGroupRepository;
let createGroup: CreateGroup;
let deleteGroup: DeleteGroup;
let listMyGroups: ListMyGroups;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  createGroup = new CreateGroup(repository, clock);
  deleteGroup = new DeleteGroup(repository);
  listMyGroups = new ListMyGroups(repository);
});

/** Grupo tal y como está guardado (con el código), con Ana de owner y Beto de miembro. */
async function groupOfAnaWithBeto(): Promise<Group> {
  const detail = await createGroup.execute(ANA, 'Grupo');
  await repository.addMember({
    groupId: detail.id,
    userId: BETO,
    now: clock.now(),
  });
  const group = await repository.findById(detail.id);
  if (group === null) {
    throw new Error('The group was just created');
  }
  return group;
}

/** Invariante de D1: la propiedad vive en la membresía, así que cada grupo tiene una y solo una con rol `owner`. */
async function ownersOf(groupId: string): Promise<number> {
  const members = await repository.listMembers(groupId);
  return members.filter((member) => member.role === 'owner').length;
}

describe('DeleteGroup', () => {
  it('El owner borra el grupo', async () => {
    const group = await groupOfAnaWithBeto();

    await expect(deleteGroup.execute(ANA, group.id)).resolves.toBeUndefined();

    await expect(listMyGroups.execute(ANA)).resolves.toEqual([]);
    await expect(listMyGroups.execute(BETO)).resolves.toEqual([]);
    await expect(
      repository.findByInviteCode(group.inviteCode),
    ).resolves.toBeNull();
    await expect(repository.listMembers(group.id)).resolves.toEqual([]);
  });

  it('Un miembro no puede borrar', async () => {
    const group = await groupOfAnaWithBeto();

    await expect(deleteGroup.execute(BETO, group.id)).rejects.toBeInstanceOf(
      OwnerRoleRequired,
    );

    await expect(repository.findById(group.id)).resolves.not.toBeNull();
    await expect(listMyGroups.execute(BETO)).resolves.toHaveLength(1);
  });

  it('answers GroupNotFound to a stranger, an unknown group and a malformed id', async () => {
    const group = await groupOfAnaWithBeto();

    await expect(deleteGroup.execute(CARLA, group.id)).rejects.toBeInstanceOf(
      GroupNotFound,
    );
    await expect(
      deleteGroup.execute(ANA, '66e9a00000000000000000ff'),
    ).rejects.toBeInstanceOf(GroupNotFound);
    await expect(
      deleteGroup.execute(ANA, 'no-es-un-id'),
    ).rejects.toBeInstanceOf(GroupNotFound);
  });

  it('cada grupo tiene exactamente una membresía owner', async () => {
    const first = await groupOfAnaWithBeto();
    const second = await createGroup.execute(BETO, 'De Beto');
    await repository.addMember({
      groupId: second.id,
      userId: ANA,
      now: clock.now(),
    });
    // Regenerar el código y borrar otro grupo no tocan la membresía del owner.
    await new RotateInviteCode(repository, clock).execute(ANA, first.id);
    const third = await createGroup.execute(ANA, 'Para borrar');
    await deleteGroup.execute(ANA, third.id);

    await expect(ownersOf(first.id)).resolves.toBe(1);
    await expect(ownersOf(second.id)).resolves.toBe(1);
    // El grupo borrado no deja ninguna membresía atrás.
    await expect(ownersOf(third.id)).resolves.toBe(0);
    await expect(repository.listMembers(third.id)).resolves.toEqual([]);
  });
});

describe('DeleteGroup when the role changes between the read and the write', () => {
  it('answers forbidden when the owner transferred the group before the write', async () => {
    const group = await groupOfAnaWithBeto();
    // Ana transfirió en otra pestaña: el repositorio no encuentra su membresía `owner` y no borra nada.
    vi.spyOn(repository, 'deleteGroup').mockResolvedValueOnce('not_owner');

    await expect(deleteGroup.execute(ANA, group.id)).rejects.toBeInstanceOf(
      OwnerRoleRequired,
    );
  });

  it('answers GroupNotFound when another deletion won', async () => {
    const group = await groupOfAnaWithBeto();
    vi.spyOn(repository, 'deleteGroup').mockResolvedValueOnce('not_found');

    await expect(deleteGroup.execute(ANA, group.id)).rejects.toBeInstanceOf(
      GroupNotFound,
    );
  });

  it('asks the repository to delete as the requester', async () => {
    const group = await groupOfAnaWithBeto();
    const writes = vi.spyOn(repository, 'deleteGroup');

    await deleteGroup.execute(ANA, group.id);

    expect(writes).toHaveBeenCalledWith(group.id, ANA);
  });
});
