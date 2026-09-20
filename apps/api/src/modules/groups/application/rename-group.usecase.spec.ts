import { beforeEach, describe, expect, it } from 'vitest';
import {
  GroupNotFound,
  InvalidGroupName,
  OwnerRoleRequired,
} from '../domain/errors';
import { CreateGroup } from './create-group.usecase';
import { GetGroup } from './get-group.usecase';
import { RenameGroup } from './rename-group.usecase';
import {
  MovableClock,
  StubInviteCodeGenerator,
} from './testing/groups-test-doubles';
import { InMemoryGroupRepository } from './testing/in-memory-group.repository';

const ANA = '66e9a0000000000000000001';
const BETO = '66e9a0000000000000000002';
const CARLA = '66e9a0000000000000000003';
const UNKNOWN_GROUP = '66e9a00000000000000000ff';

let clock: MovableClock;
let repository: InMemoryGroupRepository;
let renameGroup: RenameGroup;
let getGroup: GetGroup;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  renameGroup = new RenameGroup(repository, clock);
  getGroup = new GetGroup(repository);
});

async function groupOfAnaWithBeto() {
  const group = await new CreateGroup(repository, clock).execute(
    ANA,
    'Backend Bolivia',
  );
  await repository.addMember({
    groupId: group.id,
    userId: BETO,
    now: clock.now(),
  });
  return group;
}

describe('RenameGroup', () => {
  it('El owner renombra', async () => {
    const group = await groupOfAnaWithBeto();

    const detail = await renameGroup.execute(ANA, group.id, ' Backend LatAm ');

    expect(detail).toEqual({
      id: group.id,
      name: 'Backend LatAm',
      role: 'owner',
      memberCount: 2,
      createdAt: '2026-09-17T10:00:00.000Z',
      inviteCode: group.inviteCode,
      defaultVisibility: 'public',
    });
    await expect(getGroup.execute(BETO, group.id)).resolves.toMatchObject({
      name: 'Backend LatAm',
    });
  });

  it('Un miembro no puede renombrar', async () => {
    const group = await groupOfAnaWithBeto();

    await expect(
      renameGroup.execute(BETO, group.id, 'Mío ahora'),
    ).rejects.toBeInstanceOf(OwnerRoleRequired);

    await expect(getGroup.execute(ANA, group.id)).resolves.toMatchObject({
      name: 'Backend Bolivia',
    });
  });

  it.each(['', '   ', 'a'.repeat(61)])('Nombre inválido: %j', async (name) => {
    const group = await groupOfAnaWithBeto();

    await expect(
      renameGroup.execute(ANA, group.id, name),
    ).rejects.toBeInstanceOf(InvalidGroupName);

    await expect(getGroup.execute(ANA, group.id)).resolves.toMatchObject({
      name: 'Backend Bolivia',
    });
  });

  it('answers GroupNotFound to a stranger, an unknown group and a malformed id', async () => {
    const group = await groupOfAnaWithBeto();

    for (const [userId, groupId] of [
      [CARLA, group.id],
      [ANA, UNKNOWN_GROUP],
      [ANA, 'no-es-un-id'],
    ] as const) {
      await expect(
        renameGroup.execute(userId, groupId, 'Otro nombre'),
      ).rejects.toBeInstanceOf(GroupNotFound);
    }
  });

  it('checks the role before the name', async () => {
    const group = await groupOfAnaWithBeto();

    await expect(
      renameGroup.execute(BETO, group.id, ''),
    ).rejects.toBeInstanceOf(OwnerRoleRequired);
  });
});
