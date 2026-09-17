import { groupRoleSchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  canBeRemoved,
  canDeleteGroup,
  canLeaveGroup,
  canRemoveMembers,
  canRenameGroup,
  canRotateInviteCode,
  createMembership,
  GROUP_ROLES,
  isOwner,
} from './membership';

const now = new Date('2026-09-17T10:00:00.000Z');

describe('group roles', () => {
  it('matches the shared role contract', () => {
    expect([...GROUP_ROLES]).toEqual(groupRoleSchema.options);
  });

  it.each([
    ['owner', true],
    ['member', false],
  ] as const)('isOwner(%s) is %s', (role, owner) => {
    expect(isOwner(role)).toBe(owner);
  });
});

describe('what the owner can do', () => {
  it.each([
    ['rename', canRenameGroup],
    ['rotate the invite code', canRotateInviteCode],
    ['delete the group', canDeleteGroup],
    ['remove members', canRemoveMembers],
  ] as const)('only the owner can %s', (_action, can) => {
    expect(can('owner')).toBe(true);
    expect(can('member')).toBe(false);
  });
});

describe('leaving and being removed', () => {
  it('lets a member leave', () => {
    expect(canLeaveGroup('member')).toBe(true);
  });

  it('does not let the owner leave', () => {
    expect(canLeaveGroup('owner')).toBe(false);
  });

  it('lets a member be removed', () => {
    expect(canBeRemoved('member')).toBe(true);
  });

  it('does not let the owner membership be removed', () => {
    expect(canBeRemoved('owner')).toBe(false);
  });
});

describe('createMembership', () => {
  it('stamps joinedAt with the given instant', () => {
    expect(
      createMembership({
        groupId: '66e9a0000000000000000001',
        userId: '66e9a0000000000000000002',
        role: 'owner',
        now,
      }),
    ).toEqual({
      groupId: '66e9a0000000000000000001',
      userId: '66e9a0000000000000000002',
      role: 'owner',
      joinedAt: now,
    });
  });
});
