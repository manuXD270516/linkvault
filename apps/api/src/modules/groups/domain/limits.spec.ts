import { describe, expect, it } from 'vitest';
import {
  hasReachedGroupLimit,
  isGroupFull,
  MAX_GROUPS_PER_USER,
  MAX_MEMBERS_PER_GROUP,
} from './limits';

describe('group limits', () => {
  it('caps a group at 50 members and a user at 20 groups', () => {
    expect(MAX_MEMBERS_PER_GROUP).toBe(50);
    expect(MAX_GROUPS_PER_USER).toBe(20);
  });

  it.each([
    [0, false],
    [MAX_MEMBERS_PER_GROUP - 1, false],
    [MAX_MEMBERS_PER_GROUP, true],
    // Una carrera puede dejar 51 miembros (D4): a partir de ahí el grupo sigue estando lleno.
    [MAX_MEMBERS_PER_GROUP + 1, true],
  ])('a group with %i members is full: %s', (memberCount, full) => {
    expect(isGroupFull(memberCount)).toBe(full);
  });

  it.each([
    [0, false],
    [MAX_GROUPS_PER_USER - 1, false],
    [MAX_GROUPS_PER_USER, true],
    [MAX_GROUPS_PER_USER + 1, true],
  ])('a user in %i groups reached the limit: %s', (groupCount, reached) => {
    expect(hasReachedGroupLimit(groupCount)).toBe(reached);
  });
});
