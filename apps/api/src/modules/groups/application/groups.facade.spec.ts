import { beforeEach, describe, expect, it } from 'vitest';
import { CreateGroup } from './create-group.usecase';
import { GroupsFacade } from './groups.facade';
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
let facade: GroupsFacade;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  facade = new GroupsFacade(repository);
});

describe('GroupsFacade', () => {
  it('Otro módulo comprueba pertenencia', async () => {
    const createGroup = new CreateGroup(repository, clock);
    const own = await createGroup.execute(ANA, 'De Ana');
    const other = await createGroup.execute(BETO, 'De Beto');

    await expect(facade.isMember(own.id, ANA)).resolves.toBe(true);
    await expect(facade.isMember(other.id, ANA)).resolves.toBe(false);
  });

  it('answers false for an unknown group, a malformed id and an orphan group', async () => {
    await expect(facade.isMember(ORPHAN_GROUP, ANA)).resolves.toBe(false);
    await expect(facade.isMember('no-es-un-id', ANA)).resolves.toBe(false);
    await expect(facade.isMember(ORPHAN_GROUP, 'no-es-un-id')).resolves.toBe(
      false,
    );
  });

  it('lists the groups of a user with their role, newest first', async () => {
    const createGroup = new CreateGroup(repository, clock);
    const own = await createGroup.execute(ANA, 'De Ana');
    const other = await createGroup.execute(BETO, 'De Beto');
    clock.advance(3_600_000);
    await repository.addMember({
      groupId: other.id,
      userId: ANA,
      now: clock.now(),
    });

    await expect(facade.getGroupsOf(ANA)).resolves.toEqual([
      {
        groupId: other.id,
        name: 'De Beto',
        role: 'member',
        defaultVisibility: 'public',
      },
      {
        groupId: own.id,
        name: 'De Ana',
        role: 'owner',
        defaultVisibility: 'public',
      },
    ]);
  });

  it('leaves orphan memberships out of the list', async () => {
    const own = await new CreateGroup(repository, clock).execute(ANA, 'Vivo');
    await repository.addMember({
      groupId: ORPHAN_GROUP,
      userId: ANA,
      now: clock.now(),
    });

    await expect(facade.getGroupsOf(ANA)).resolves.toEqual([
      {
        groupId: own.id,
        name: 'Vivo',
        role: 'owner',
        defaultVisibility: 'public',
      },
    ]);
  });

  it('answers the role of a member and null for anybody else', async () => {
    const createGroup = new CreateGroup(repository, clock);
    const own = await createGroup.execute(ANA, 'De Ana');
    await repository.addMember({
      groupId: own.id,
      userId: BETO,
      now: clock.now(),
    });

    await expect(facade.membershipOf(own.id, ANA)).resolves.toBe('owner');
    await expect(facade.membershipOf(own.id, BETO)).resolves.toBe('member');
    await expect(facade.membershipOf(ORPHAN_GROUP, ANA)).resolves.toBeNull();
    await expect(facade.membershipOf('no-es-un-id', ANA)).resolves.toBeNull();
  });

  it('answers an empty list for a user without groups and for a malformed id', async () => {
    await expect(facade.getGroupsOf(BETO)).resolves.toEqual([]);
    await expect(facade.getGroupsOf('no-es-un-id')).resolves.toEqual([]);
  });
});

describe('GroupsFacade.peersAmong', () => {
  it('peersAmong delegates to the repository', async () => {
    const createGroup = new CreateGroup(repository, clock);
    const own = await createGroup.execute(ANA, 'De Ana');
    await repository.addMember({
      groupId: own.id,
      userId: BETO,
      now: clock.now(),
    });
    await createGroup.execute(CARLA, 'De Carla');

    await expect(facade.peersAmong(ANA, [BETO, CARLA])).resolves.toEqual(
      new Set([BETO]),
    );
    expect(repository.peersAmongQueries).toBe(1);
  });
});
