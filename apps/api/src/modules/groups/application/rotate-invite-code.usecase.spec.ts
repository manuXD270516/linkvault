import { inviteCodeResponseSchema } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { GroupNotFound, OwnerRoleRequired } from '../domain/errors';
import type { Group } from '../domain/group';
import { isValidInviteCode } from '../domain/invite-code';
import { CreateGroup } from './create-group.usecase';
import { GetGroup } from './get-group.usecase';
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
let rotateInviteCode: RotateInviteCode;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  rotateInviteCode = new RotateInviteCode(repository, clock);
});

/** Grupo tal y como está guardado (con el código), con Ana de owner y Beto de miembro. */
async function groupOfAnaWithBeto(): Promise<Group> {
  const detail = await new CreateGroup(repository, clock).execute(ANA, 'Grupo');
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

describe('RotateInviteCode', () => {
  it('Regenerar el código', async () => {
    const group = await groupOfAnaWithBeto();

    const response = await rotateInviteCode.execute(ANA, group.id);

    expect(inviteCodeResponseSchema.parse(response)).toEqual(response);
    expect(response.inviteCode).not.toBe(group.inviteCode);
    expect(isValidInviteCode(response.inviteCode)).toBe(true);
    // El código anterior deja de servir; el nuevo resuelve al mismo grupo.
    await expect(
      repository.findByInviteCode(group.inviteCode),
    ).resolves.toBeNull();
    await expect(
      repository.findByInviteCode(response.inviteCode),
    ).resolves.toMatchObject({ id: group.id });
  });

  it('keeps the current members inside the group', async () => {
    const group = await groupOfAnaWithBeto();

    await rotateInviteCode.execute(ANA, group.id);

    await expect(repository.listMembers(group.id)).resolves.toHaveLength(2);
    await expect(
      new GetGroup(repository).execute(BETO, group.id),
    ).resolves.toMatchObject({ role: 'member' });
  });

  it('Un miembro no puede regenerar', async () => {
    const group = await groupOfAnaWithBeto();

    await expect(
      rotateInviteCode.execute(BETO, group.id),
    ).rejects.toBeInstanceOf(OwnerRoleRequired);

    await expect(
      repository.findByInviteCode(group.inviteCode),
    ).resolves.toMatchObject({ id: group.id });
  });

  it('answers GroupNotFound to a stranger and to an unknown group', async () => {
    const group = await groupOfAnaWithBeto();

    await expect(
      rotateInviteCode.execute(CARLA, group.id),
    ).rejects.toBeInstanceOf(GroupNotFound);
    await expect(
      rotateInviteCode.execute(ANA, 'no-es-un-id'),
    ).rejects.toBeInstanceOf(GroupNotFound);
  });
});
