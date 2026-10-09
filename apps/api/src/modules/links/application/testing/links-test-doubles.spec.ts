import { linkCreatedEvent } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { objectId } from './link-fixtures';
import {
  IN_MEMORY_SESSION,
  InMemoryGroupMembership,
  InMemoryLinkUserDirectory,
  InMemoryOutbox,
  MovableClock,
} from './links-test-doubles';

const ANA = objectId(1);
const BETO = objectId(2);
const BACKEND = objectId(10);
const FRONTEND = objectId(11);

describe('MovableClock', () => {
  it('gives the same instant until it is moved', () => {
    const clock = new MovableClock();
    const first = clock.now();
    clock.advance(60_000);

    expect(clock.now().getTime() - first.getTime()).toBe(60_000);
  });
});

describe('InMemoryOutbox', () => {
  it('accumulates the events that were written, in order', async () => {
    const outbox = new InMemoryOutbox();
    await outbox.append(
      linkCreatedEvent({ linkId: objectId(5), previewVersion: 1 }),
      IN_MEMORY_SESSION,
    );
    await outbox.append(
      linkCreatedEvent({ linkId: objectId(6), previewVersion: 1 }),
      IN_MEMORY_SESSION,
    );

    expect(outbox.size).toBe(2);
    expect(outbox.appended.map((event) => event.type)).toEqual([
      'LinkCreated.v1',
      'LinkCreated.v1',
    ]);
    expect(outbox.appended[0]?.payload).toEqual({
      linkId: objectId(5),
      previewVersion: 1,
    });
  });

  it('knows whether every event was written inside the transaction', async () => {
    const outbox = new InMemoryOutbox();
    await outbox.append(
      linkCreatedEvent({ linkId: objectId(5), previewVersion: 1 }),
      IN_MEMORY_SESSION,
    );

    expect(outbox.allWrittenWith(IN_MEMORY_SESSION)).toBe(true);
    expect(outbox.allWrittenWith({})).toBe(false);
  });

  it('starts empty', () => {
    expect(new InMemoryOutbox().size).toBe(0);
  });
});

describe('InMemoryGroupMembership', () => {
  it('answers the role of a member and null for anybody else', async () => {
    const membership = new InMemoryGroupMembership()
      .withMember(BACKEND, ANA, 'owner', 'Backend Bolivia')
      .withMember(BACKEND, BETO);

    expect(await membership.membershipOf(BACKEND, ANA)).toBe('owner');
    expect(await membership.membershipOf(BACKEND, BETO)).toBe('member');
    expect(await membership.membershipOf(FRONTEND, ANA)).toBeNull();
    expect(await membership.membershipOf(BACKEND, objectId(99))).toBeNull();
  });

  it('answers the groups of the user with their name and role', async () => {
    const membership = new InMemoryGroupMembership()
      .withMember(BACKEND, ANA, 'owner', 'Backend Bolivia')
      .withMember(FRONTEND, ANA, 'member', 'Frontend LatAm')
      .withMember(FRONTEND, BETO);

    expect(await membership.groupsOf(ANA)).toEqual([
      {
        groupId: BACKEND,
        name: 'Backend Bolivia',
        role: 'owner',
        defaultVisibility: 'public',
      },
      {
        groupId: FRONTEND,
        name: 'Frontend LatAm',
        role: 'member',
        defaultVisibility: 'public',
      },
    ]);
    expect(await membership.groupsOf(objectId(99))).toEqual([]);
  });

  it('carries the default visibility declared for each group', async () => {
    const membership = new InMemoryGroupMembership()
      .withGroup(FRONTEND, 'Frontend LatAm', 'private')
      .withMember(FRONTEND, ANA, 'owner');

    expect(await membership.groupsOf(ANA)).toEqual([
      {
        groupId: FRONTEND,
        name: 'Frontend LatAm',
        role: 'owner',
        defaultVisibility: 'private',
      },
    ]);
  });

  it('counts how many times the groups of a user were asked for', async () => {
    const membership = new InMemoryGroupMembership().withMember(BACKEND, ANA);
    await membership.groupsOf(ANA);
    await membership.groupsOf(ANA);

    expect(membership.groupsOfCalls).toBe(2);
  });
});

describe('InMemoryLinkUserDirectory', () => {
  it('resolves the display names it knows and leaves the rest out', async () => {
    const directory = new InMemoryLinkUserDirectory()
      .set(ANA, 'Ana')
      .set(BETO, 'Beto');

    expect(await directory.displayNamesOf([ANA, objectId(99)])).toEqual(
      new Map([[ANA, 'Ana']]),
    );
  });

  it('resolves every name of the page in one call', async () => {
    const directory = new InMemoryLinkUserDirectory()
      .set(ANA, 'Ana')
      .set(BETO, 'Beto');
    await directory.displayNamesOf([ANA, BETO, ANA]);

    expect(directory.calls).toBe(1);
  });
});

describe('InMemoryGroupMembership.peersAmong', () => {
  it('peersAmong counts calls and returns co-members', async () => {
    const membership = new InMemoryGroupMembership()
      .withMember(BACKEND, ANA, 'owner')
      .withMember(BACKEND, BETO)
      .withMember(FRONTEND, objectId(3));

    expect(membership.peersAmongCalls).toBe(0);
    expect(
      await membership.peersAmong(ANA, [BETO, objectId(3), objectId(99)]),
    ).toEqual(new Set([BETO]));
    await membership.peersAmong(ANA, []);

    expect(membership.peersAmongCalls).toBe(2);
  });

  it('rejects with the configured failure', async () => {
    const membership = new InMemoryGroupMembership();
    membership.peersAmongFailure = new Error('forced');

    await expect(membership.peersAmong(ANA, [BETO])).rejects.toThrow('forced');
    expect(membership.peersAmongCalls).toBe(1);
  });
});
