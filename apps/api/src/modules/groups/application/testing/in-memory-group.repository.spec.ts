import { beforeEach, describe, expect, it } from 'vitest';
import { InviteCodeUnavailable } from '../ports/invite-code-generator.port';
import {
  StubInviteCodeGenerator,
  sequentialInviteCode,
} from './groups-test-doubles';
import { InMemoryGroupRepository } from './in-memory-group.repository';

const OWNER = '66e9a0000000000000000001';
const MEMBER = '66e9a0000000000000000002';
const STRANGER = '66e9a0000000000000000003';
const MALFORMED = 'no-es-un-id';
const UNKNOWN_GROUP = '66e9a00000000000000000ff';

const now = new Date('2026-09-17T10:00:00.000Z');
const later = new Date('2026-09-18T12:00:00.000Z');

let generator: StubInviteCodeGenerator;
let repository: InMemoryGroupRepository;

beforeEach(() => {
  generator = new StubInviteCodeGenerator();
  repository = new InMemoryGroupRepository(generator);
});

describe('create', () => {
  it('stores the group with an id of the expected format and the owner membership', async () => {
    const group = await repository.create({
      name: 'Backend Bolivia',
      ownerId: OWNER,
      now,
    });

    expect(group).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{24}$/),
      name: 'Backend Bolivia',
      inviteCode: sequentialInviteCode(0),
      createdAt: now,
      updatedAt: now,
    });
    await expect(repository.findMembership(group.id, OWNER)).resolves.toEqual({
      groupId: group.id,
      userId: OWNER,
      role: 'owner',
      joinedAt: now,
    });
  });

  it('asks the generator again when the code collides and stops after 5 attempts', async () => {
    const repeated = new StubInviteCodeGenerator([
      'A2B3C4D5',
      'A2B3C4D5',
      'Z9Y8X7W6',
    ]);
    const repositoryWithCollisions = new InMemoryGroupRepository(repeated);

    const first = await repositoryWithCollisions.create({
      name: 'Uno',
      ownerId: OWNER,
      now,
    });
    const second = await repositoryWithCollisions.create({
      name: 'Dos',
      ownerId: OWNER,
      now,
    });

    expect(first.inviteCode).toBe('A2B3C4D5');
    expect(second.inviteCode).toBe('Z9Y8X7W6');
    expect(repeated.calls).toBe(3);
  });

  it('gives up with InviteCodeUnavailable when every attempt collides', async () => {
    const always = new StubInviteCodeGenerator(Array(6).fill('A2B3C4D5'));
    const repositoryWithCollisions = new InMemoryGroupRepository(always);
    await repositoryWithCollisions.create({ name: 'Uno', ownerId: OWNER, now });

    await expect(
      repositoryWithCollisions.create({ name: 'Dos', ownerId: OWNER, now }),
    ).rejects.toBeInstanceOf(InviteCodeUnavailable);
  });
});

describe('lookups', () => {
  it('finds a group by id and by invite code', async () => {
    const group = await repository.create({ name: 'Uno', ownerId: OWNER, now });

    await expect(repository.findById(group.id)).resolves.toEqual(group);
    await expect(
      repository.findByInviteCode(group.inviteCode),
    ).resolves.toEqual(group);
  });

  it.each([
    ['an unknown id', UNKNOWN_GROUP],
    ['a malformed id', MALFORMED],
  ])('returns null for %s', async (_case, groupId) => {
    await expect(repository.findById(groupId)).resolves.toBeNull();
  });

  it('returns null for an unknown invite code', async () => {
    await expect(repository.findByInviteCode('A2B3C4D5')).resolves.toBeNull();
  });

  it('returns null for a membership of a malformed group id or user id', async () => {
    const group = await repository.create({ name: 'Uno', ownerId: OWNER, now });

    await expect(
      repository.findMembership(MALFORMED, OWNER),
    ).resolves.toBeNull();
    await expect(
      repository.findMembership(group.id, MALFORMED),
    ).resolves.toBeNull();
    await expect(
      repository.findMembership(group.id, STRANGER),
    ).resolves.toBeNull();
  });
});

describe('memberships', () => {
  it('adds a member with the role member and does not duplicate it', async () => {
    const group = await repository.create({ name: 'Uno', ownerId: OWNER, now });

    const first = await repository.addMember({
      groupId: group.id,
      userId: MEMBER,
      now: later,
    });
    const again = await repository.addMember({
      groupId: group.id,
      userId: MEMBER,
      now: new Date('2026-09-19T12:00:00.000Z'),
    });

    expect(first).toEqual({
      groupId: group.id,
      userId: MEMBER,
      role: 'member',
      joinedAt: later,
    });
    expect(again).toEqual(first);
    await expect(repository.listMembers(group.id)).resolves.toHaveLength(2);
  });

  it('lists the members by joinedAt ascending', async () => {
    const group = await repository.create({ name: 'Uno', ownerId: OWNER, now });
    await repository.addMember({
      groupId: group.id,
      userId: STRANGER,
      now: new Date('2026-09-20T10:00:00.000Z'),
    });
    await repository.addMember({
      groupId: group.id,
      userId: MEMBER,
      now: later,
    });

    const members = await repository.listMembers(group.id);

    expect(members.map((member) => member.userId)).toEqual([
      OWNER,
      MEMBER,
      STRANGER,
    ]);
  });

  it('returns an empty list of members for a malformed group id', async () => {
    await expect(repository.listMembers(MALFORMED)).resolves.toEqual([]);
  });

  it('removes a membership and reports whether it existed', async () => {
    const group = await repository.create({ name: 'Uno', ownerId: OWNER, now });
    await repository.addMember({
      groupId: group.id,
      userId: MEMBER,
      now: later,
    });

    await expect(repository.removeMember(group.id, MEMBER)).resolves.toBe(true);
    await expect(repository.removeMember(group.id, MEMBER)).resolves.toBe(
      false,
    );
    await expect(repository.removeMember(MALFORMED, MEMBER)).resolves.toBe(
      false,
    );
    await expect(repository.removeMember(group.id, MALFORMED)).resolves.toBe(
      false,
    );
  });

  it('releases an orphan membership without its group', async () => {
    await repository.addMember({
      groupId: UNKNOWN_GROUP,
      userId: MEMBER,
      now: later,
    });

    await expect(repository.removeMember(UNKNOWN_GROUP, MEMBER)).resolves.toBe(
      true,
    );
  });
});

describe('counts and lists of a user', () => {
  it('counts the members of several groups in one call, leaving the empty ones out', async () => {
    const first = await repository.create({ name: 'Uno', ownerId: OWNER, now });
    const second = await repository.create({
      name: 'Dos',
      ownerId: OWNER,
      now,
    });
    await repository.addMember({
      groupId: first.id,
      userId: MEMBER,
      now: later,
    });
    await repository.deleteGroup(second.id);

    const counts = await repository.countMembers([
      first.id,
      second.id,
      MALFORMED,
    ]);

    expect(counts.get(first.id)).toBe(2);
    expect(counts.has(second.id)).toBe(false);
    expect(counts.has(MALFORMED)).toBe(false);
  });

  it('lists the groups of the user by joinedAt descending', async () => {
    const first = await repository.create({ name: 'Uno', ownerId: OWNER, now });
    const second = await repository.create({
      name: 'Dos',
      ownerId: STRANGER,
      now,
    });
    await repository.addMember({
      groupId: second.id,
      userId: OWNER,
      now: later,
    });

    const groups = await repository.listGroupsOfUser(OWNER);

    expect(
      groups.map((entry) => [entry.group.id, entry.role, entry.joinedAt]),
    ).toEqual([
      [second.id, 'member', later],
      [first.id, 'owner', now],
    ]);
  });

  it('leaves an orphan membership out of the list and out of the limit count', async () => {
    const group = await repository.create({ name: 'Uno', ownerId: OWNER, now });
    await repository.addMember({
      groupId: UNKNOWN_GROUP,
      userId: OWNER,
      now: later,
    });

    await expect(repository.listGroupsOfUser(OWNER)).resolves.toHaveLength(1);
    await expect(repository.countGroupsOfUser(OWNER)).resolves.toBe(1);
    await expect(
      repository.findMembership(group.id, OWNER),
    ).resolves.not.toBeNull();
  });

  it('answers an empty list and zero for a malformed user id', async () => {
    await expect(repository.listGroupsOfUser(MALFORMED)).resolves.toEqual([]);
    await expect(repository.countGroupsOfUser(MALFORMED)).resolves.toBe(0);
  });
});

describe('rename, rotate and delete', () => {
  it('renames the group and moves updatedAt', async () => {
    const group = await repository.create({ name: 'Uno', ownerId: OWNER, now });

    const renamed = await repository.rename(group.id, 'Backend LatAm', later);

    expect(renamed).toEqual({
      ...group,
      name: 'Backend LatAm',
      updatedAt: later,
    });
    await expect(repository.findById(group.id)).resolves.toEqual(renamed);
  });

  it('rotates the invite code and the old one stops working', async () => {
    const group = await repository.create({ name: 'Uno', ownerId: OWNER, now });

    const rotated = await repository.rotateInviteCode(group.id, later);

    expect(rotated?.inviteCode).not.toBe(group.inviteCode);
    await expect(
      repository.findByInviteCode(group.inviteCode),
    ).resolves.toBeNull();
    await expect(
      repository.findByInviteCode(rotated?.inviteCode ?? ''),
    ).resolves.toEqual(rotated);
  });

  it.each([
    ['an unknown group', UNKNOWN_GROUP],
    ['a malformed id', MALFORMED],
  ])('returns null when renaming or rotating %s', async (_case, groupId) => {
    await expect(repository.rename(groupId, 'Otro', later)).resolves.toBeNull();
    await expect(
      repository.rotateInviteCode(groupId, later),
    ).resolves.toBeNull();
  });

  it('deletes the group and all its memberships', async () => {
    const group = await repository.create({ name: 'Uno', ownerId: OWNER, now });
    await repository.addMember({
      groupId: group.id,
      userId: MEMBER,
      now: later,
    });

    await expect(repository.deleteGroup(group.id)).resolves.toBe(true);

    expect(repository.size).toBe(0);
    await expect(repository.findById(group.id)).resolves.toBeNull();
    await expect(repository.listMembers(group.id)).resolves.toEqual([]);
    await expect(repository.listGroupsOfUser(MEMBER)).resolves.toEqual([]);
  });

  it.each([
    ['an unknown group', UNKNOWN_GROUP],
    ['a malformed id', MALFORMED],
  ])('reports false when deleting %s', async (_case, groupId) => {
    await expect(repository.deleteGroup(groupId)).resolves.toBe(false);
  });
});
