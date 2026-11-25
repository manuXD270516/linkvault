import { weeklyPlanResponseSchema } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
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

async function track(status: ApplicationStatus, daysAgo: number) {
  const linkId = objectId(0x1000 + seq);
  seq += 1;
  h.links.withLink(linkId).readableBy(ANA, linkId);
  const { application } = await h.trackLink.execute(ANA, { linkId, status });
  h.repository.overwrite(application.id, {
    statusChangedAt: new Date(h.clock.now().getTime() - daysAgo * DAY),
  });
  return application;
}

describe('GetWeeklyPlan', () => {
  it('returns three actions for five candidates', async () => {
    for (const days of [11, 12, 13, 14, 15]) {
      await track('applied', days);
    }

    const plan = await h.weeklyPlan.execute(ANA);

    expect(weeklyPlanResponseSchema.parse(plan).actions).toHaveLength(3);
    expect(plan.planner).toBe('rules');
    expect(plan.actions.map((action) => action.reason)).toEqual([
      expect.objectContaining({ kind: 'quiet', daysQuiet: 15 }),
      expect.objectContaining({ kind: 'quiet', daysQuiet: 14 }),
      expect.objectContaining({ kind: 'quiet', daysQuiet: 13 }),
    ]);
  });

  it('returns real ids and the link card in each action', async () => {
    const application = await track('applied', 12);

    const [action] = (await h.weeklyPlan.execute(ANA)).actions;

    expect(action).toMatchObject({
      candidateId: `follow_up:${application.id}`,
      rule: 'follow_up',
      applicationId: application.id,
      linkId: application.linkId,
      link: { displayUrl: expect.stringContaining(application.linkId) },
    });
  });

  it('returns an empty plan when nothing applies', async () => {
    await track('applied', 3);
    await track('saved', 40);

    const plan = await h.weeklyPlan.execute(ANA);

    expect(plan).toEqual({
      weekKey: '2026-W38',
      planner: 'rules',
      actions: [],
      doneThisWeek: 0,
    });
  });

  it('reading twice writes nothing', async () => {
    const application = await track('applied', 12);
    const before = await h.repository.findOwned(application.id, ANA);
    const events = await h.timeline.execute(ANA, application.id);

    const first = await h.weeklyPlan.execute(ANA);
    const second = await h.weeklyPlan.execute(ANA);

    expect(second).toEqual(first);
    expect(h.planDecisions.count()).toBe(0);
    expect(h.planDecisions.upsertCalls).toBe(0);
    expect(await h.repository.findOwned(application.id, ANA)).toEqual(before);
    expect(await h.timeline.execute(ANA, application.id)).toEqual(events);
  });

  it('uses the UTC ISO week of the clock', async () => {
    h.clock.current = new Date('2026-12-31T23:30:00.000Z');

    expect((await h.weeklyPlan.execute(ANA)).weekKey).toBe('2026-W53');
  });

  it('only shows the own applications of the user', async () => {
    const other = objectId(0xb2);
    const linkId = objectId(0x5000);
    h.links.withLink(linkId).readableBy(other, linkId);
    const { application } = await h.trackLink.execute(other, {
      linkId,
      status: 'applied',
    });
    h.repository.overwrite(application.id, {
      statusChangedAt: new Date(h.clock.now().getTime() - 20 * DAY),
    });

    expect((await h.weeklyPlan.execute(ANA)).actions).toEqual([]);
  });
});
