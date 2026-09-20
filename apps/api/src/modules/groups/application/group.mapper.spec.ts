import { groupDetailSchema, groupSummarySchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import type { Group } from '../domain/group';
import { toGroupDetail, toGroupSummary } from './group.mapper';

const group: Group = {
  id: '66e9a0000000000000000001',
  name: 'Backend Bolivia',
  inviteCode: 'A2B3C4D5',
  defaultVisibility: 'public',
  createdAt: new Date('2026-09-17T10:00:00.000Z'),
  updatedAt: new Date('2026-09-18T12:00:00.000Z'),
};
const joinedAt = new Date('2026-09-19T09:30:00.000Z');

describe('toGroupSummary', () => {
  it('matches the shared contract with dates as ISO', () => {
    const summary = toGroupSummary(group, 'member', 3, joinedAt);

    expect(summary).toEqual({
      id: group.id,
      name: 'Backend Bolivia',
      role: 'member',
      memberCount: 3,
      joinedAt: '2026-09-19T09:30:00.000Z',
    });
    expect(groupSummarySchema.parse(summary)).toEqual(summary);
  });

  it('never carries the invite code, not even for the owner', () => {
    expect(toGroupSummary(group, 'owner', 1, joinedAt)).not.toHaveProperty(
      'inviteCode',
    );
  });
});

describe('toGroupDetail', () => {
  it('gives the owner the invite code when the endpoint asks for it', () => {
    const detail = toGroupDetail(group, 'owner', 2, {
      includeInviteCode: true,
    });

    expect(detail).toEqual({
      id: group.id,
      name: 'Backend Bolivia',
      role: 'owner',
      memberCount: 2,
      createdAt: '2026-09-17T10:00:00.000Z',
      inviteCode: 'A2B3C4D5',
      defaultVisibility: 'public',
    });
    expect(groupDetailSchema.parse(detail)).toEqual(detail);
  });

  it('hides the invite code from a member even if the endpoint asks for it', () => {
    const detail = toGroupDetail(group, 'member', 2, {
      includeInviteCode: true,
    });

    expect(detail).not.toHaveProperty('inviteCode');
    expect(groupDetailSchema.parse(detail)).toEqual(detail);
  });

  it('hides the invite code when the endpoint does not ask for it', () => {
    expect(
      toGroupDetail(group, 'owner', 2, { includeInviteCode: false }),
    ).not.toHaveProperty('inviteCode');
  });

  // La visibilidad por defecto viaja para cualquier miembro (D3 de public-preview-share): quien comparte tiene derecho
  // a saber si su link nacerá público. El resumen de la lista NO la lleva: ahí no se comparte nada.
  it('carries the default visibility for any member', () => {
    expect(
      toGroupDetail({ ...group, defaultVisibility: 'private' }, 'member', 2, {
        includeInviteCode: false,
      }).defaultVisibility,
    ).toBe('private');
    expect(toGroupSummary(group, 'owner', 1, joinedAt)).not.toHaveProperty(
      'defaultVisibility',
    );
  });
});
