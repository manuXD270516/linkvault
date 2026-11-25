import { beforeEach, describe, expect, it } from 'vitest';
import { WeeklyPlanActionNotFound } from '../domain/errors';
import type { ApplicationStatus } from '../domain/application-status';
import {
  applicationsHarness,
  objectId,
  type ApplicationsHarness,
} from './testing/applications-test-harness';

const ANA = objectId(0xa1);
const BETO = objectId(0xb2);
const DAY = 24 * 60 * 60 * 1000;

let h: ApplicationsHarness;
let seq = 1;

beforeEach(() => {
  h = applicationsHarness();
  seq = 1;
});

async function track(
  userId: string,
  status: ApplicationStatus,
  daysAgo: number,
) {
  const linkId = objectId(0x1000 + seq);
  seq += 1;
  h.links.withLink(linkId).readableBy(userId, linkId);
  const { application } = await h.trackLink.execute(userId, {
    linkId,
    status,
  });
  h.repository.overwrite(application.id, {
    statusChangedAt: new Date(h.clock.now().getTime() - daysAgo * DAY),
  });
  return application;
}

describe('DecideWeeklyPlanAction', () => {
  it('done hides the action and the next candidate enters', async () => {
    const quietest = await track(ANA, 'applied', 40);
    const second = await track(ANA, 'applied', 30);
    const third = await track(ANA, 'applied', 20);
    const fourth = await track(ANA, 'applied', 12);

    const plan = await h.decidePlan.execute(ANA, {
      candidateId: `follow_up:${quietest.id}`,
      decision: 'done',
    });

    expect(plan.actions.map((action) => action.applicationId)).toEqual([
      second.id,
      third.id,
      fourth.id,
    ]);
    expect(plan.doneThisWeek).toBe(1);
  });

  it('decision does not touch the application', async () => {
    const application = await track(ANA, 'applied', 12);
    const before = await h.repository.findOwned(application.id, ANA);
    const events = await h.timeline.execute(ANA, application.id);

    await h.decidePlan.execute(ANA, {
      candidateId: `follow_up:${application.id}`,
      decision: 'done',
    });

    const after = await h.repository.findOwned(application.id, ANA);
    expect(after?.version).toBe(before?.version);
    expect(after?.statusChangedAt).toEqual(before?.statusChangedAt);
    expect(after).toEqual(before);
    expect(await h.timeline.execute(ANA, application.id)).toEqual(events);
  });

  it('unknown, foreign or malformed candidate is not found and writes nothing', async () => {
    const foreign = await track(BETO, 'applied', 12);
    await track(ANA, 'applied', 12);

    for (const candidateId of [
      `follow_up:${foreign.id}`,
      'follow_up:no-es-un-id',
      `follow_up:${objectId(0xdead)}`,
      'no-tiene-regla',
      // Existe la postulación de Ana, pero no cumple esta regla.
      `apply_before_close:${objectId(0xbeef)}`,
    ]) {
      await expect(
        h.decidePlan.execute(ANA, { candidateId, decision: 'done' }),
      ).rejects.toBeInstanceOf(WeeklyPlanActionNotFound);
    }
    expect(h.planDecisions.count()).toBe(0);
    expect(h.planDecisions.upsertCalls).toBe(0);
  });

  it('a candidate of another rule of the same application is not found', async () => {
    const application = await track(ANA, 'applied', 12);

    await expect(
      h.decidePlan.execute(ANA, {
        candidateId: `apply_before_close:${application.id}`,
        decision: 'dismissed',
      }),
    ).rejects.toBeInstanceOf(WeeklyPlanActionNotFound);
    expect(h.planDecisions.count()).toBe(0);
  });

  it('repeating a decision keeps one document', async () => {
    const application = await track(ANA, 'applied', 12);
    const candidateId = `follow_up:${application.id}`;

    await h.decidePlan.execute(ANA, { candidateId, decision: 'snoozed' });
    await h.decidePlan.execute(ANA, { candidateId, decision: 'done' });

    expect(h.planDecisions.count()).toBe(1);
    const stored = await h.planDecisions.listActive(ANA, h.clock.now());
    expect(stored).toHaveLength(1);
    expect(stored[0]?.decision).toBe('done');
  });

  it('a hidden candidate can still be decided again', async () => {
    const application = await track(ANA, 'applied', 12);
    const candidateId = `follow_up:${application.id}`;
    await h.decidePlan.execute(ANA, { candidateId, decision: 'snoozed' });

    const plan = await h.decidePlan.execute(ANA, {
      candidateId,
      decision: 'dismissed',
    });

    expect(plan.actions).toEqual([]);
    expect(h.planDecisions.count()).toBe(1);
  });
});
