import { groupMemberSchema } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { GroupNotFound } from '../domain/errors';
import { CreateGroup } from './create-group.usecase';
import { UNKNOWN_MEMBER_NAME } from './group.mapper';
import { ListMembers } from './list-members.usecase';
import {
  InMemoryMemberDirectory,
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
let directory: InMemoryMemberDirectory;
let listMembers: ListMembers;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  directory = new InMemoryMemberDirectory()
    .set(ANA, 'Ana')
    .set(BETO, 'Beto')
    .set(CARLA, 'Carla');
  listMembers = new ListMembers(repository, directory);
});

/** Grupo de Ana con Beto (11:00) y Carla (12:00) dentro. */
async function groupWithThree() {
  const group = await new CreateGroup(repository, clock).execute(ANA, 'Grupo');
  clock.advance(3_600_000);
  await repository.addMember({
    groupId: group.id,
    userId: BETO,
    now: clock.now(),
  });
  clock.advance(3_600_000);
  await repository.addMember({
    groupId: group.id,
    userId: CARLA,
    now: clock.now(),
  });
  return group;
}

describe('ListMembers', () => {
  it('Un miembro ve la lista', async () => {
    const group = await groupWithThree();

    const members = await listMembers.execute(BETO, group.id);

    expect(members).toEqual([
      {
        userId: ANA,
        displayName: 'Ana',
        role: 'owner',
        joinedAt: '2026-09-17T10:00:00.000Z',
      },
      {
        userId: BETO,
        displayName: 'Beto',
        role: 'member',
        joinedAt: '2026-09-17T11:00:00.000Z',
      },
      {
        userId: CARLA,
        displayName: 'Carla',
        role: 'member',
        joinedAt: '2026-09-17T12:00:00.000Z',
      },
    ]);
    for (const member of members) {
      // El schema es estricto: un email en la lista haría fallar este parse.
      expect(groupMemberSchema.parse(member)).toEqual(member);
    }
  });

  it('Un extraño no ve la lista', async () => {
    const group = await groupWithThree();

    await expect(listMembers.execute(DIEGO, group.id)).rejects.toBeInstanceOf(
      GroupNotFound,
    );
  });

  it('answers GroupNotFound for an unknown group and a malformed id', async () => {
    await expect(
      listMembers.execute(ANA, '66e9a00000000000000000ff'),
    ).rejects.toBeInstanceOf(GroupNotFound);
    await expect(
      listMembers.execute(ANA, 'no-es-un-id'),
    ).rejects.toBeInstanceOf(GroupNotFound);
  });

  it('asks the directory once for every member', async () => {
    const group = await groupWithThree();
    let calls = 0;
    const counting = {
      displayNamesOf: (userIds: readonly string[]) => {
        calls += 1;
        return directory.displayNamesOf(userIds);
      },
    };

    await new ListMembers(repository, counting).execute(ANA, group.id);

    expect(calls).toBe(1);
  });

  it('falls back to a neutral name when the directory does not know the user', async () => {
    const group = await groupWithThree();
    await repository.addMember({
      groupId: group.id,
      userId: DIEGO,
      now: clock.now(),
    });

    const members = await listMembers.execute(ANA, group.id);

    expect(members.at(-1)).toMatchObject({
      userId: DIEGO,
      displayName: UNKNOWN_MEMBER_NAME,
    });
  });
});
