import { beforeEach, describe, expect, it } from 'vitest';
import { GroupsFacade } from '../../groups/application/groups.facade';
import {
  MovableClock,
  StubInviteCodeGenerator,
} from '../../groups/application/testing/groups-test-doubles';
import { InMemoryGroupRepository } from '../../groups/application/testing/in-memory-group.repository';
import { GroupsFacadeMembership } from './groups-facade-membership';

// Adaptador GROUP_MEMBERSHIP sobre GroupsFacade (D1 de job-links), con el repositorio en memoria de `groups`: `links`
// nunca toca sus colecciones y solo entra por su entrada pública.

const ANA = '66e9a0000000000000000001';
const BETO = '66e9a0000000000000000002';
const ORPHAN_GROUP = '66e9a00000000000000000ff';

let clock: MovableClock;
let groups: InMemoryGroupRepository;
let membership: GroupsFacadeMembership;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  groups = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  membership = new GroupsFacadeMembership(new GroupsFacade(groups));
});

/** Grupo con su owner, por el repositorio de `groups`: el caso de uso de crear no es entrada pública para `links`. */
function createGroupOf(ownerId: string, name: string) {
  return groups.create({ name, ownerId, now: clock.now() });
}

describe('membershipOf', () => {
  it('answers the role of a member', async () => {
    const own = await createGroupOf(ANA, 'Backend Bolivia');
    await groups.addMember({ groupId: own.id, userId: BETO, now: clock.now() });

    expect(await membership.membershipOf(own.id, ANA)).toBe('owner');
    expect(await membership.membershipOf(own.id, BETO)).toBe('member');
  });

  it('answers null for a stranger, an unknown group and a malformed id', async () => {
    const other = await createGroupOf(BETO, 'De Beto');

    expect(await membership.membershipOf(other.id, ANA)).toBeNull();
    expect(await membership.membershipOf(ORPHAN_GROUP, ANA)).toBeNull();
    expect(await membership.membershipOf('no-es-un-id', ANA)).toBeNull();
  });
});

describe('groupsOf', () => {
  it('answers the groups of the user with their name and role, newest first', async () => {
    const own = await createGroupOf(ANA, 'Backend Bolivia');
    const other = await createGroupOf(BETO, 'Frontend LatAm');
    clock.advance(3_600_000);
    await groups.addMember({
      groupId: other.id,
      userId: ANA,
      now: clock.now(),
    });

    expect(await membership.groupsOf(ANA)).toEqual([
      { groupId: other.id, name: 'Frontend LatAm', role: 'member', defaultVisibility: 'public' },
      { groupId: own.id, name: 'Backend Bolivia', role: 'owner', defaultVisibility: 'public' },
    ]);
  });

  it('leaves orphan memberships out, so nobody sees links of a deleted group', async () => {
    const own = await createGroupOf(ANA, 'Backend Bolivia');
    await groups.addMember({
      groupId: ORPHAN_GROUP,
      userId: ANA,
      now: clock.now(),
    });

    expect(await membership.groupsOf(ANA)).toEqual([
      { groupId: own.id, name: 'Backend Bolivia', role: 'owner', defaultVisibility: 'public' },
    ]);
  });

  it('answers an empty list for a user without groups and for a malformed id', async () => {
    expect(await membership.groupsOf(BETO)).toEqual([]);
    expect(await membership.groupsOf('no-es-un-id')).toEqual([]);
  });

  // El ajuste viaja en la misma lectura que la pertenencia (D3 de public-preview-share): guardar o importar saben si
  // el link nacerá publicado sin una consulta más.
  it('carries the default visibility of each group', async () => {
    const own = await createGroupOf(ANA, 'Backend Bolivia');
    await groups.updateSettings(own.id, 'private', clock.now());

    expect(await membership.groupsOf(ANA)).toEqual([
      {
        groupId: own.id,
        name: 'Backend Bolivia',
        role: 'owner',
        defaultVisibility: 'private',
      },
    ]);
  });

  it('carries nothing else of the group: no invite code', async () => {
    await createGroupOf(ANA, 'Backend Bolivia');

    expect(JSON.stringify(await membership.groupsOf(ANA))).not.toContain(
      'inviteCode',
    );
  });
});
