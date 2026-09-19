import { apiErrorCodeSchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  AlreadyOwner,
  GroupFull,
  GroupNotFound,
  GroupsError,
  InvalidGroupName,
  InvalidInviteCode,
  MemberNotFound,
  OwnerCannotLeave,
  OwnerRoleRequired,
  TooManyGroups,
  TooManyJoinAttempts,
} from './errors';

const errors = [
  new GroupNotFound(),
  new MemberNotFound(),
  new OwnerRoleRequired(),
  new InvalidInviteCode(),
  new GroupFull(),
  new TooManyGroups(),
  new OwnerCannotLeave(),
  new AlreadyOwner(),
  new TooManyJoinAttempts(900),
  new InvalidGroupName(),
];

describe('groups domain errors', () => {
  it.each([
    [new GroupNotFound(), 'group_not_found'],
    [new MemberNotFound(), 'member_not_found'],
    [new OwnerRoleRequired(), 'forbidden'],
    [new InvalidInviteCode(), 'invalid_invite_code'],
    [new GroupFull(), 'group_full'],
    [new TooManyGroups(), 'too_many_groups'],
    [new OwnerCannotLeave(), 'owner_cannot_leave'],
    [new AlreadyOwner(), 'already_owner'],
    [new TooManyJoinAttempts(900), 'too_many_attempts'],
    [new InvalidGroupName(), 'validation_error'],
  ] as const)('%s carries the API code %s', (error, code) => {
    expect(error).toBeInstanceOf(GroupsError);
    expect(error.code).toBe(code);
  });

  it('only uses codes of the shared error contract', () => {
    for (const error of errors) {
      expect(apiErrorCodeSchema.options).toContain(error.code);
    }
  });

  it('keeps the error name for the logs', () => {
    expect(errors.map((error) => error.name)).toEqual([
      'GroupNotFound',
      'MemberNotFound',
      'OwnerRoleRequired',
      'InvalidInviteCode',
      'GroupFull',
      'TooManyGroups',
      'OwnerCannotLeave',
      'AlreadyOwner',
      'TooManyJoinAttempts',
      'InvalidGroupName',
    ]);
  });

  it('gives the same message for a missing group and one the user is not in', () => {
    expect(new GroupNotFound().message).toBe(new GroupNotFound().message);
  });

  it.each([
    [900, 900],
    [0.2, 1],
    [0, 1],
    [59.1, 60],
  ])(
    'sends a whole Retry-After of at least one second (%s -> %s)',
    (seconds, expected) => {
      expect(new TooManyJoinAttempts(seconds).retryAfterSeconds).toBe(expected);
    },
  );

  it('names the field of an invalid group name', () => {
    expect(new InvalidGroupName().field).toBe('name');
  });

  it('carries no invite code, name or email in the message', () => {
    for (const error of errors) {
      expect(error.message).not.toMatch(/@|[0-9A-Z]{8}/);
    }
  });
});
