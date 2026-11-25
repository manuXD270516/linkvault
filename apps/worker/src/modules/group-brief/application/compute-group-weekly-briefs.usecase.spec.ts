import { verifyGroupWeeklyBrief } from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UniverseOffer } from '../domain/group-brief-universe';
import { ComputeGroupWeeklyBriefs } from './compute-group-weekly-briefs.usecase';
import type { GroupBriefVerifier } from './ports/group-brief.ports';
import { InMemoryGroupBriefCatalog } from './testing/in-memory-group-brief.catalog';
import { InMemoryGroupBriefStore } from './testing/in-memory-group-brief.store';

const G1 = '1'.repeat(24);
const G2 = '2'.repeat(24);
const WEEK = '2026-W48';
// Miércoles 25/11 05:00Z, ese mismo día más tarde, y el jueves 26.
const DAY1 = new Date('2026-11-25T05:00:00.000Z');
const DAY1_LATER = new Date('2026-11-25T17:30:00.000Z');
const DAY2 = new Date('2026-11-26T05:00:00.000Z');

function id(n: number): string {
  return n.toString(16).padStart(24, 'a');
}

function offer(n: number, patch: Partial<UniverseOffer> = {}): UniverseOffer {
  return {
    id: id(n),
    sharedAt: '2026-11-24T10:00:00.000Z',
    closedAt: null,
    expiresAt: null,
    skills: [],
    ...patch,
  };
}

/** Cierra en 3 días y dos ofertas piden Docker: closing_soon + skill_demand. */
const LIVELY: readonly UniverseOffer[] = [
  offer(1, { expiresAt: '2026-11-28', skills: ['Docker'] }),
  offer(2, { skills: ['docker'] }),
  offer(3, { sharedAt: '2026-11-18T10:00:00.000Z' }),
];

function setup(
  options: { enabled?: boolean; verify?: GroupBriefVerifier } = {},
) {
  const store = new InMemoryGroupBriefStore();
  const catalog = new InMemoryGroupBriefCatalog(store);
  const useCase = new ComputeGroupWeeklyBriefs(
    catalog,
    store,
    options.enabled ?? true,
    options.verify ?? verifyGroupWeeklyBrief,
  );
  return { store, catalog, useCase };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ComputeGroupWeeklyBriefs', () => {
  it('first tick of the week creates the brief', async () => {
    const { store, catalog, useCase } = setup();
    catalog.addGroup(G1, LIVELY);
    const summary = await useCase.execute(DAY1);
    expect(summary).toMatchObject({
      weekKey: WEEK,
      groupsScanned: 1,
      upserted: 1,
      unchanged: 0,
    });
    const doc = store.get(G1, WEEK);
    expect(doc?.asOf).toBe('2026-11-25');
    expect(doc?.bullets.map((b) => b.factId)).toEqual([
      'closing_soon',
      'skill_demand:docker',
      'shared_last_week',
    ]);
  });

  it('next day recomputes with the new asOf', async () => {
    const { store, catalog, useCase } = setup();
    catalog.addGroup(G1, LIVELY);
    await useCase.execute(DAY1);
    const summary = await useCase.execute(DAY2);
    expect(summary.upserted).toBe(1);
    expect(store.get(G1, WEEK)?.asOf).toBe('2026-11-26');
    expect(store.documents.size).toBe(1);
  });

  it('same day rerun is unchanged and writes nothing', async () => {
    const { store, catalog, useCase } = setup();
    catalog.addGroup(G1, LIVELY);
    await useCase.execute(DAY1);
    const writes = store.replaces;
    const summary = await useCase.execute(DAY1_LATER);
    expect(summary).toMatchObject({ upserted: 0, unchanged: 1 });
    expect(store.replaces).toBe(writes);
  });

  it('unreadable stored document is overwritten', async () => {
    const { store, catalog, useCase } = setup();
    catalog.addGroup(G1, LIVELY);
    catalog.rawStored.set(`${G1}:${WEEK}`, { garbage: true });
    const summary = await useCase.execute(DAY1);
    expect(summary.upserted).toBe(1);
    expect(store.get(G1, WEEK)?.version).toBe(1);
  });

  it('empty day clears the week', async () => {
    const { store, catalog, useCase } = setup();
    catalog.addGroup(G1, LIVELY);
    await useCase.execute(DAY1);
    catalog.addGroup(G1, []);
    const summary = await useCase.execute(DAY2);
    expect(summary.cleared).toBe(1);
    expect(store.get(G1, WEEK)).toBeUndefined();
  });

  it('empty day with nothing stored does not write', async () => {
    const { store, catalog, useCase } = setup();
    catalog.addGroup(G1, []);
    const summary = await useCase.execute(DAY1);
    expect(summary).toMatchObject({ groupsScanned: 1, cleared: 0 });
    expect(store.clears).toBe(0);
  });

  it('rejected brief keeps the last saved one', async () => {
    const { store, catalog, useCase } = setup();
    catalog.addGroup(G1, LIVELY);
    await useCase.execute(DAY1);
    const before = store.get(G1, WEEK);
    const forced = new ComputeGroupWeeklyBriefs(catalog, store, true, () => ({
      ok: false,
      violations: [{ code: 'count_mismatch', factId: 'closing_soon' }],
    }));
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const summary = await forced.execute(DAY2);
    expect(summary).toMatchObject({ rejected: 1, upserted: 0 });
    expect(store.get(G1, WEEK)).toBe(before);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line).toContain(G1);
    expect(line).toContain(WEEK);
    expect(line).toContain('count_mismatch');
  });

  it('disabled does nothing', async () => {
    const { store, catalog, useCase } = setup({ enabled: false });
    catalog.addGroup(G1, LIVELY);
    const summary = await useCase.execute(DAY1);
    expect(summary.groupsScanned).toBe(0);
    expect(store.replaces).toBe(0);
  });

  it('a failing group does not stop the others', async () => {
    const { store, catalog, useCase } = setup();
    catalog.addGroup(G1, LIVELY);
    catalog.addGroup(G2, LIVELY);
    const scan = catalog.scanGroupOffers.bind(catalog);
    vi.spyOn(catalog, 'scanGroupOffers').mockImplementation((groupId, limit) =>
      groupId === G1 ? Promise.reject(new Error('boom')) : scan(groupId, limit),
    );
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const summary = await useCase.execute(DAY1);
    expect(summary).toMatchObject({ groupsScanned: 2, upserted: 1 });
    expect(store.get(G2, WEEK)).toBeDefined();
  });
});

describe('tick summary', () => {
  it('tick summary counts bullets by kind', async () => {
    const { catalog, useCase } = setup();
    catalog.addGroup(G1, LIVELY);
    catalog.addGroup(G2, [
      offer(9, { skills: ['Go'] }),
      offer(8, { skills: ['go'] }),
    ]);
    const summary = await useCase.execute(DAY1);
    expect(summary.bulletsByKind).toEqual({
      closing_soon: 1,
      skill_demand: 2,
      shared_last_week: 1,
    });
  });

  it('tick summary has no group ids', async () => {
    const { catalog, useCase } = setup();
    catalog.addGroup(G1, LIVELY);
    catalog.addGroup(G2, LIVELY);
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    await useCase.execute(DAY1);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      event: 'group_brief_tick',
      weekKey: WEEK,
      groupsScanned: 2,
    });
    for (const secret of [G1, G2, id(1), id(2)]) {
      expect(line).not.toContain(secret);
    }
  });
});
