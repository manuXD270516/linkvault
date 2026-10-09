import { describe, expect, it } from 'vitest';
import { objectId } from './testing/link-fixtures';
import { InMemoryGroupMembership } from './testing/links-test-doubles';
import {
  visibleAuthorsByRecipient,
  visibleAuthorsFor,
} from './visible-authors';

const ANA = objectId(1);
const BETO = objectId(2);
const CARLA = objectId(3);
const DANI = objectId(4);
const BACKEND = objectId(10);
const FRONTEND = objectId(11);

describe('visibleAuthorsFor', () => {
  it('includes the viewer', async () => {
    const membership = new InMemoryGroupMembership();

    const visible = await visibleAuthorsFor(membership, CARLA, [CARLA, ANA]);

    expect(visible.has(CARLA)).toBe(true);
  });

  it('includes a co-member of any group', async () => {
    // Beto comparte con Ana un grupo que no es el del link: cuenta igual (Q3 = a).
    const membership = new InMemoryGroupMembership()
      .withMember(BACKEND, ANA)
      .withMember(BACKEND, BETO)
      .withMember(FRONTEND, DANI);

    const visible = await visibleAuthorsFor(membership, BETO, [ANA, DANI]);

    expect(visible.has(ANA)).toBe(true);
    expect(visible.has(DANI)).toBe(false);
  });

  it('excludes someone who shares no group', async () => {
    const membership = new InMemoryGroupMembership()
      .withMember(BACKEND, ANA)
      .withMember(FRONTEND, CARLA);

    const visible = await visibleAuthorsFor(membership, CARLA, [ANA]);

    expect(visible.has(ANA)).toBe(false);
    expect(visible.has(CARLA)).toBe(true);
  });

  it('issues exactly one query when there are foreign authors', async () => {
    const membership = new InMemoryGroupMembership()
      .withMember(BACKEND, ANA)
      .withMember(BACKEND, BETO);

    await visibleAuthorsFor(membership, CARLA, [ANA, BETO, ANA, CARLA]);

    expect(membership.peersAmongCalls).toBe(1);
  });

  it('issues no query when the candidates are empty or only the viewer', async () => {
    const membership = new InMemoryGroupMembership();

    const empty = await visibleAuthorsFor(membership, CARLA, []);
    const own = await visibleAuthorsFor(membership, CARLA, [CARLA, CARLA]);

    expect(membership.peersAmongCalls).toBe(0);
    expect([...empty]).toEqual([CARLA]);
    expect([...own]).toEqual([CARLA]);
  });

  it('a peersAmong failure propagates (no fallback set)', async () => {
    const membership = new InMemoryGroupMembership();
    membership.peersAmongFailure = new Error('mongo down');

    await expect(visibleAuthorsFor(membership, CARLA, [ANA])).rejects.toThrow(
      'mongo down',
    );
  });
});

describe('visibleAuthorsByRecipient', () => {
  it('gives each recipient the authors they share a group with', async () => {
    const membership = new InMemoryGroupMembership()
      .withMember(BACKEND, ANA)
      .withMember(BACKEND, BETO)
      .withMember(FRONTEND, CARLA);

    const byRecipient = await visibleAuthorsByRecipient(
      membership,
      [ANA],
      [BETO, CARLA, ANA],
    );

    expect(byRecipient.get(BETO)?.has(ANA)).toBe(true);
    expect(byRecipient.get(CARLA)?.has(ANA)).toBe(false);
    // Quien es autor se ve a sí mismo.
    expect(byRecipient.get(ANA)?.has(ANA)).toBe(true);
  });

  it('issues one query per distinct author', async () => {
    const membership = new InMemoryGroupMembership()
      .withMember(BACKEND, ANA)
      .withMember(BACKEND, BETO)
      .withMember(BACKEND, CARLA);

    await visibleAuthorsByRecipient(
      membership,
      [ANA, BETO, ANA],
      [CARLA, DANI],
    );

    expect(membership.peersAmongCalls).toBe(2);
  });

  it('issues no query without authors and gives every recipient an empty set', async () => {
    const membership = new InMemoryGroupMembership();

    const byRecipient = await visibleAuthorsByRecipient(
      membership,
      [],
      [BETO, CARLA],
    );

    expect(membership.peersAmongCalls).toBe(0);
    expect([...(byRecipient.get(BETO) ?? [])]).toEqual([]);
    expect(byRecipient.size).toBe(2);
  });

  it('a peersAmong failure propagates (no fallback set)', async () => {
    const membership = new InMemoryGroupMembership();
    membership.peersAmongFailure = new Error('mongo down');

    await expect(
      visibleAuthorsByRecipient(membership, [ANA], [BETO]),
    ).rejects.toThrow('mongo down');
  });
});
