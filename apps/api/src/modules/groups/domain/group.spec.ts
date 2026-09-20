import { describe, expect, it } from 'vitest';
import {
  canChangeDefaultVisibility,
  createGroup,
  DEFAULT_GROUP_VISIBILITY,
  GROUP_NAME_MAX_LENGTH,
  type Group,
  isValidGroupName,
  normalizeGroupName,
  renameGroup,
  visibilityOf,
  withDefaultVisibility,
  withInviteCode,
} from './group';

const now = new Date('2026-09-17T10:00:00.000Z');
const later = new Date('2026-09-18T12:00:00.000Z');

const group: Group = {
  id: '66e9a0000000000000000001',
  name: 'Backend Bolivia',
  inviteCode: 'A2B3C4D5',
  defaultVisibility: 'public',
  createdAt: now,
  updatedAt: now,
};

describe('normalizeGroupName', () => {
  it('removes the outer spaces and keeps the inner ones', () => {
    expect(normalizeGroupName('  Backend Bolivia ')).toBe('Backend Bolivia');
  });
});

describe('isValidGroupName', () => {
  it.each([
    ['', false],
    ['   ', false],
    ['a', true],
    [' a ', true],
    ['a'.repeat(GROUP_NAME_MAX_LENGTH), true],
    [`  ${'a'.repeat(GROUP_NAME_MAX_LENGTH)}  `, true],
    ['a'.repeat(GROUP_NAME_MAX_LENGTH + 1), false],
  ])('name %j is valid: %s', (name, valid) => {
    expect(isValidGroupName(name)).toBe(valid);
  });

  it('counts code points, not UTF-16 units', () => {
    expect(isValidGroupName('🧑'.repeat(GROUP_NAME_MAX_LENGTH))).toBe(true);
    expect(isValidGroupName('🧑'.repeat(GROUP_NAME_MAX_LENGTH + 1))).toBe(
      false,
    );
  });

  it('exposes the name limit', () => {
    expect(GROUP_NAME_MAX_LENGTH).toBe(60);
  });
});

describe('createGroup', () => {
  it('normalizes the name and stamps both dates', () => {
    expect(
      createGroup({ name: '  Backend Bolivia ', inviteCode: 'A2B3C4D5', now }),
    ).toEqual({
      name: 'Backend Bolivia',
      inviteCode: 'A2B3C4D5',
      defaultVisibility: 'public',
      createdAt: now,
      updatedAt: now,
    });
  });

  it('does not carry an owner: the ownership lives in the membership', () => {
    const created = createGroup({
      name: 'Backend',
      inviteCode: 'A2B3C4D5',
      now,
    });

    expect(Object.keys(created).sort()).toEqual([
      'createdAt',
      'defaultVisibility',
      'inviteCode',
      'name',
      'updatedAt',
    ]);
  });

  it('nace compartiendo en público', () => {
    expect(
      createGroup({ name: 'Backend', inviteCode: 'A2B3C4D5', now })
        .defaultVisibility,
    ).toBe('public');
    expect(DEFAULT_GROUP_VISIBILITY).toBe('public');
  });
});

describe('visibilityOf', () => {
  it('lee un grupo sin el ajuste como público', () => {
    expect(visibilityOf(undefined)).toBe('public');
  });

  it('respeta lo guardado', () => {
    expect(visibilityOf('private')).toBe('private');
    expect(visibilityOf('public')).toBe('public');
  });
});

describe('canChangeDefaultVisibility', () => {
  it('es del owner', () => {
    expect(canChangeDefaultVisibility('owner')).toBe(true);
    expect(canChangeDefaultVisibility('member')).toBe(false);
  });
});

describe('withDefaultVisibility', () => {
  it('cambia el ajuste y mueve updatedAt', () => {
    expect(withDefaultVisibility(group, 'private', later)).toEqual({
      ...group,
      defaultVisibility: 'private',
      updatedAt: later,
    });
  });

  it('no toca el nombre ni el código ni la fecha de alta', () => {
    const changed = withDefaultVisibility(group, 'private', later);

    expect(changed.name).toBe(group.name);
    expect(changed.inviteCode).toBe(group.inviteCode);
    expect(changed.createdAt).toBe(group.createdAt);
  });
});

describe('renameGroup', () => {
  it('normalizes the new name and moves updatedAt', () => {
    expect(renameGroup(group, '  Backend LatAm ', later)).toEqual({
      ...group,
      name: 'Backend LatAm',
      updatedAt: later,
    });
  });

  it('keeps the id, the invite code and createdAt', () => {
    const renamed = renameGroup(group, 'Backend LatAm', later);

    expect(renamed.id).toBe(group.id);
    expect(renamed.inviteCode).toBe(group.inviteCode);
    expect(renamed.createdAt).toBe(group.createdAt);
  });
});

describe('withInviteCode', () => {
  it('replaces the invite code and moves updatedAt', () => {
    expect(withInviteCode(group, 'Z9Y8X7W6', later)).toEqual({
      ...group,
      inviteCode: 'Z9Y8X7W6',
      updatedAt: later,
    });
  });
});
