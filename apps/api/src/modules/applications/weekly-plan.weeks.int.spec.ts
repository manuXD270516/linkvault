import { weeklyPlanResponseSchema, type WeeklyPlanResponse } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createApplicationsTestApp,
  type ApplicationsTestApp,
} from '../../test-support/applications-test-app';
import type { TestMember } from '../../test-support/links-test-app';
import { APPLICATIONS_CLOCK, type Clock } from './application/ports/clock.port';
import { APPLICATIONS_COLLECTION } from './infrastructure/application.schemas';
import { WEEKLY_PLAN_DECISIONS_COLLECTION } from './infrastructure/weekly-plan-decision.schemas';

// Semanas ISO y vigencia de las decisiones de «Tu semana» por HTTP (tarea 4.6b de weekly-plan): el reloj de la app se
// mueve de 2026-W48 a W49, W50 y W52, y a los 35 días de una decisión.

const DAY = 24 * 60 * 60 * 1000;
const W48 = new Date('2026-11-25T10:00:00.000Z');
const W49 = new Date('2026-12-02T10:00:00.000Z');
const W50 = new Date('2026-12-09T10:00:00.000Z');
const W52 = new Date('2026-12-23T10:00:00.000Z');

describe('weekly plan weeks', () => {
  let http: ApplicationsTestApp;
  let current = W48;
  let urlCounter = 3_866_000_000;

  beforeAll(async () => {
    http = await createApplicationsTestApp('weekly-plan-weeks', getMongoTestUri());
    const clock = http.app.get<Clock>(APPLICATIONS_CLOCK, { strict: false });
    vi.spyOn(clock, 'now').mockImplementation(() => new Date(current));
  });

  afterEach(() => {
    current = W48;
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await http.close();
  });

  /** Ana con una postulación `applied` quieta desde hace 12 días respecto de W48, y su `candidateId`. */
  async function setup(): Promise<{ ana: TestMember; candidateId: string }> {
    current = W48;
    const ana = await http.authenticated('Ana');
    urlCounter += 1;
    const saved = await http.save(
      ana,
      `https://www.linkedin.com/jobs/view/${urlCounter}/`,
    );
    const { application } = await http.track(ana, saved.link.id, 'applied');
    await http.connection
      .collection(APPLICATIONS_COLLECTION)
      .updateOne(
        { _id: new mongoose.Types.ObjectId(application.id) },
        { $set: { statusChangedAt: new Date(W48.getTime() - 12 * DAY) } },
      );
    return { ana, candidateId: `follow_up:${application.id}` };
  }

  async function planAt(ana: TestMember, at: Date): Promise<WeeklyPlanResponse> {
    current = at;
    const response = await http.request('GET', '/api/applications/weekly-plan', {
      authorization: ana.authorization,
    });
    expect(response.statusCode).toBe(200);
    return weeklyPlanResponseSchema.parse(response.json());
  }

  async function decide(
    ana: TestMember,
    candidateId: string,
    decision: 'done' | 'dismissed' | 'snoozed',
  ): Promise<WeeklyPlanResponse> {
    current = W48;
    const response = await http.request(
      'POST',
      '/api/applications/weekly-plan/decisions',
      { authorization: ana.authorization, body: { candidateId, decision } },
    );
    expect(response.statusCode).toBe(200);
    return weeklyPlanResponseSchema.parse(response.json());
  }

  const ids = (plan: WeeklyPlanResponse) =>
    plan.actions.map((action) => action.candidateId);

  it('snoozed returns next week', async () => {
    const { ana, candidateId } = await setup();
    expect(ids(await planAt(ana, W48))).toEqual([candidateId]);

    expect(ids(await decide(ana, candidateId, 'snoozed'))).toEqual([]);

    expect(ids(await planAt(ana, W48))).toEqual([]);
    const next = await planAt(ana, W49);
    expect(next.weekKey).toBe('2026-W49');
    expect(ids(next)).toEqual([candidateId]);
  });

  it('done skips one week', async () => {
    const { ana, candidateId } = await setup();

    const after = await decide(ana, candidateId, 'done');
    expect(after.doneThisWeek).toBe(1);

    expect(ids(await planAt(ana, W48))).toEqual([]);
    expect(ids(await planAt(ana, W49))).toEqual([]);
    const later = await planAt(ana, W50);
    expect(later.weekKey).toBe('2026-W50');
    expect(ids(later)).toEqual([candidateId]);
    expect(later.doneThisWeek).toBe(0);
  });

  it('dismissed stays hidden while the decision lives', async () => {
    const { ana, candidateId } = await setup();
    await decide(ana, candidateId, 'dismissed');

    for (const week of [W49, W50, W52]) {
      expect(ids(await planAt(ana, week))).toEqual([]);
    }
  });

  it('dismissed reappears after 35 days', async () => {
    const { ana, candidateId } = await setup();
    await decide(ana, candidateId, 'dismissed');

    const justBefore = new Date(W48.getTime() + 35 * DAY);
    expect(ids(await planAt(ana, justBefore))).toEqual([]);

    const justAfter = new Date(W48.getTime() + 35 * DAY + 1000);
    const plan = await planAt(ana, justAfter);

    // El documento sigue en la colección: la regla no depende de que el monitor TTL haya corrido (N2).
    expect(
      await http.connection
        .collection(WEEKLY_PLAN_DECISIONS_COLLECTION)
        .countDocuments({ userId: new mongoose.Types.ObjectId(ana.userId) }),
    ).toBe(1);
    expect(ids(plan)).toEqual([candidateId]);
  });
});
