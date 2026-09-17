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
      { groupId: other.id, role: 'member' },
      { groupId: own.id, role: 'owner' },
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
      { groupId: own.id, role: 'owner' },
    ]);
  });

  it('answers an empty list for a user without groups and for a malformed id', async () => {
    await expect(facade.getGroupsOf(BETO)).resolves.toEqual([]);
    await expect(facade.getGroupsOf('no-es-un-id')).resolves.toEqual([]);
  });
});
