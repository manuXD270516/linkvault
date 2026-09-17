import { groupSummarySchema } from '@linkvault/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateGroup } from './create-group.usecase';
import { ListMyGroups } from './list-my-groups.usecase';
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
let createGroup: CreateGroup;
let listMyGroups: ListMyGroups;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  createGroup = new CreateGroup(repository, clock);
  listMyGroups = new ListMyGroups(repository);
});

describe('ListMyGroups', () => {
  it('Lista con rol', async () => {
    const own = await createGroup.execute(ANA, 'Propio');
    const other = await new CreateGroup(repository, clock).execute(
      BETO,
      'De Beto',
    );
    clock.advance(3_600_000);
    await repository.addMember({
      groupId: other.id,
      userId: ANA,
      now: clock.now(),
    });

    const groups = await listMyGroups.execute(ANA);

    // Por `joinedAt` descendente: primero el grupo al que se unió, después el propio.
    expect(groups).toEqual([
      {
        id: other.id,
        name: 'De Beto',
        role: 'member',
        memberCount: 2,
        joinedAt: '2026-09-17T11:00:00.000Z',
      },
      {
        id: own.id,
        name: 'Propio',
        role: 'owner',
        memberCount: 1,
        joinedAt: '2026-09-17T10:00:00.000Z',
      },
    ]);
    for (const group of groups) {
      expect(groupSummarySchema.parse(group)).toEqual(group);
      expect(group).not.toHaveProperty('inviteCode');
    }
  });

  it('Sin grupos', async () => {
    await expect(listMyGroups.execute(ANA)).resolves.toEqual([]);
  });

  it('Membresía huérfana', async () => {
    const own = await createGroup.execute(ANA, 'Vivo');
    await repository.addMember({
      groupId: ORPHAN_GROUP,
      userId: ANA,
      now: clock.now(),
    });

    const groups = await listMyGroups.execute(ANA);

    expect(groups.map((group) => group.id)).toEqual([own.id]);
  });

  it('counts the members of every group in a single call', async () => {
    const first = await createGroup.execute(ANA, 'Uno');
    const second = await createGroup.execute(ANA, 'Dos');
    await repository.addMember({
      groupId: first.id,
      userId: BETO,
      now: clock.now(),
    });
    const countMembers = vi.spyOn(repository, 'countMembers');

    const groups = await listMyGroups.execute(ANA);

    expect(
      Object.fromEntries(groups.map((group) => [group.id, group.memberCount])),
    ).toEqual({ [first.id]: 2, [second.id]: 1 });
    expect(countMembers).toHaveBeenCalledTimes(1);
    countMembers.mockRestore();
  });
});
