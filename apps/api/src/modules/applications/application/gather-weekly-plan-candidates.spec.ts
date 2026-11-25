import { WEEKLY_PLAN_SCAN_MAX } from '@linkvault/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startTracking } from '../domain/application.entity';
import type { ApplicationStatus } from '../domain/application-status';
import {
  applicationsHarness,
  objectId,
  type ApplicationsHarness,
} from './testing/applications-test-harness';

const ANA = objectId(0xa1);
const DAY = 24 * 60 * 60 * 1000;

let h: ApplicationsHarness;
let seq = 1;

beforeEach(() => {
  h = applicationsHarness();
  seq = 1;
});

/** Postulación de Ana con `statusChangedAt` hace `daysAgo` días sobre el reloj del test. */
async function track(
  status: ApplicationStatus,
  daysAgo = 0,
  withSignals: Parameters<typeof h.links.withPlanSignals>[1] = {},
) {
  const linkId = objectId(0x1000 + seq);
  seq += 1;
  h.links.withLink(linkId).readableBy(ANA, linkId);
  h.links.withPlanSignals(linkId, withSignals);
  const { application } = await h.trackLink.execute(ANA, { linkId, status });
  h.repository.overwrite(application.id, {
    statusChangedAt: new Date(h.clock.now().getTime() - daysAgo * DAY),
  });
  return application;
}

describe('GatherWeeklyPlanCandidates', () => {
  it('keeps the 200 quietest applications', async () => {
    const all = [];
    for (let index = 0; index < WEEKLY_PLAN_SCAN_MAX + 5; index += 1) {
      // La primera es la más quieta (hace 300 días); la última, la más reciente.
      all.push(await track('applied', 300 - index));
    }

    const gathered = await h.gatherPlan.execute(ANA, h.clock.now());

    expect(gathered.candidates).toHaveLength(WEEKLY_PLAN_SCAN_MAX);
    const keptIds = new Set(
      [...gathered.byKey.values()].map((item) => item.application.id),
    );
    expect(keptIds.has(all[0]?.id ?? '')).toBe(true);
    expect(keptIds.has(all[WEEKLY_PLAN_SCAN_MAX - 1]?.id ?? '')).toBe(true);
    for (const newest of all.slice(WEEKLY_PLAN_SCAN_MAX)) {
      expect(keptIds.has(newest.id)).toBe(false);
    }
  });

  it('assigns opaque keys in applicationId order', async () => {
    const first = await track('applied', 5);
    const second = await track('applied', 40);

    const gathered = await h.gatherPlan.execute(ANA, h.clock.now());

    expect(gathered.byKey.get('c001')?.application.id).toBe(first.id);
    expect(gathered.byKey.get('c002')?.application.id).toBe(second.id);
    expect(gathered.candidates.map((c) => c.key)).toEqual(['c001', 'c002']);
  });

  it('skips closed and accepted applications', async () => {
    for (const status of ['rejected', 'withdrawn', 'expired', 'accepted'] as const) {
      await track(status, 30);
    }
    const open = await track('offer', 30);

    const gathered = await h.gatherPlan.execute(ANA, h.clock.now());

    expect(
      [...gathered.byKey.values()].map((item) => item.application.id),
    ).toEqual([open.id]);
  });

  it('skips links that no longer exist', async () => {
    const orphanLink = objectId(0x9999);
    await h.repository.create(
      startTracking({
        userId: ANA,
        linkId: orphanLink,
        status: 'applied',
        now: new Date(h.clock.now().getTime() - 30 * DAY),
      }),
    );
    const alive = await track('applied', 30);

    const gathered = await h.gatherPlan.execute(ANA, h.clock.now());

    expect(
      [...gathered.byKey.values()].map((item) => item.application.id),
    ).toEqual([alive.id]);
  });

  it('does not call the fit source with no saved or interested applications', async () => {
    const scoresFor = vi.fn().mockResolvedValue(new Map());
    h.fitScores.register({ scoresFor });
    await track('applied', 12);
    // Alta y respuesta de `TrackLink` también preguntan por el encaje: se cuenta solo desde aquí.
    scoresFor.mockClear();

    await h.gatherPlan.execute(ANA, h.clock.now());
    expect(scoresFor).not.toHaveBeenCalled();

    await track('interested', 1);
    scoresFor.mockClear();
    await h.gatherPlan.execute(ANA, h.clock.now());
    expect(scoresFor).toHaveBeenCalledTimes(1);
  });

  it('translates dates to relative days and carries the counts', async () => {
    const saved = await track('saved', 2, {
      expiresAt: '2026-09-22',
      knowSomeoneCount: 2,
      knowSomeoneGroupId: 'g2',
    });
    h.fitScores.register({
      scoresFor: () =>
        Promise.resolve(
          new Map([[saved.linkId, { score: 81, degraded: false }]]),
        ),
    });

    const gathered = await h.gatherPlan.execute(ANA, h.clock.now());

    expect(gathered.today).toBe('2026-09-19');
    expect(gathered.weekKey).toBe('2026-W38');
    expect(gathered.candidates[0]).toEqual({
      key: 'c001',
      status: 'saved',
      linkClosed: false,
      daysQuiet: 2,
      expiresAt: '2026-09-22',
      daysUntilExpiry: 3,
      fit: { score: 81, degraded: false },
      knowSomeone: { count: 2, groupId: 'g2' },
    });
  });

  it('asks the links facade once however many applications there are', async () => {
    await track('applied', 12);
    await track('applied', 13);
    await track('saved', 1);

    await h.gatherPlan.execute(ANA, h.clock.now());

    expect(h.links.planSignalsOfCalls).toBe(1);
  });
});
