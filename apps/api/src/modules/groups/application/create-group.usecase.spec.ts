import { groupDetailSchema } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidGroupName, TooManyGroups } from '../domain/errors';
import { MAX_GROUPS_PER_USER } from '../domain/limits';
import { CreateGroup } from './create-group.usecase';
import {
  MovableClock,
  StubInviteCodeGenerator,
} from './testing/groups-test-doubles';
import { InMemoryGroupRepository } from './testing/in-memory-group.repository';

const ANA = '66e9a0000000000000000001';
const ORPHAN_GROUP = '66e9a00000000000000000ff';

let clock: MovableClock;
let repository: InMemoryGroupRepository;
let createGroup: CreateGroup;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  createGroup = new CreateGroup(repository, clock);
});

describe('CreateGroup', () => {
  it('Grupo creado', async () => {
    const detail = await createGroup.execute(ANA, '  Backend Bolivia ');

    expect(detail).toEqual({
      id: expect.any(String),
      name: 'Backend Bolivia',
      role: 'owner',
      memberCount: 1,
      createdAt: '2026-09-17T10:00:00.000Z',
      inviteCode: expect.stringMatching(/^[0-9A-Z]{8}$/),
    });
    expect(groupDetailSchema.parse(detail)).toEqual(detail);
    await expect(
      repository.findMembership(detail.id, ANA),
    ).resolves.toMatchObject({ role: 'owner' });
  });

  it('Nombres repetidos', async () => {
    const first = await createGroup.execute(ANA, 'Backend Bolivia');
    const second = await createGroup.execute(ANA, 'Backend Bolivia');

    expect(second.id).not.toBe(first.id);
    expect(second.inviteCode).not.toBe(first.inviteCode);
    await expect(repository.countGroupsOfUser(ANA)).resolves.toBe(2);
  });

  it.each(['', '   ', 'a'.repeat(61)])(
    'rejects the name %j without writing anything',
    async (name) => {
      await expect(createGroup.execute(ANA, name)).rejects.toBeInstanceOf(
        InvalidGroupName,
      );

      expect(repository.size).toBe(0);
    },
  );

  it('Límite alcanzado al crear', async () => {
    for (let index = 0; index < MAX_GROUPS_PER_USER; index += 1) {
      await createGroup.execute(ANA, `Grupo ${index}`);
    }

    await expect(createGroup.execute(ANA, 'Uno más')).rejects.toBeInstanceOf(
      TooManyGroups,
    );

    expect(repository.size).toBe(MAX_GROUPS_PER_USER);
  });

  it('does not count an orphan membership towards the limit', async () => {
    for (let index = 0; index < MAX_GROUPS_PER_USER - 1; index += 1) {
      await createGroup.execute(ANA, `Grupo ${index}`);
    }
    await repository.addMember({
      groupId: ORPHAN_GROUP,
      userId: ANA,
      now: clock.now(),
    });

    await expect(createGroup.execute(ANA, 'Con hueco')).resolves.toMatchObject({
      role: 'owner',
    });
  });

  it('stamps createdAt with the clock', async () => {
    clock.advance(86_400_000);

    const detail = await createGroup.execute(ANA, 'Mañana');

    expect(detail.createdAt).toBe('2026-09-18T10:00:00.000Z');
  });
});
