import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { WeeklyPlanDecisionRequest } from '@linkvault/shared';
import { weeklyPlanActionWith, weeklyPlanWith } from '../../../testing/applications-testing';
import {
  apiError,
  providePageTesting,
  sessionWith,
  settle,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { WeeklyPlanStore } from './weekly-plan.store';

const PLAN_URL = '/api/applications/weekly-plan';
const DECISIONS_URL = '/api/applications/weekly-plan/decisions';

/** Argumentos de `flush` para una respuesta de error de la API. */
function failure(code: string, status: number): [{ code: string; message: string }, { status: number; statusText: string }] {
  const { body, options } = apiError(code, status);
  return [body, { status: options.status, statusText: options.statusText }];
}

const first = weeklyPlanActionWith();
const second = weeklyPlanActionWith({
  candidateId: 'follow_up:a-l2:2026-W48',
  rule: 'follow_up',
  applicationId: 'a-l2',
  linkId: 'l2',
  reason: { kind: 'quiet', daysQuiet: 12, status: 'applied' },
});

describe('WeeklyPlanStore', () => {
  let store: WeeklyPlanStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
    store = TestBed.inject(WeeklyPlanStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => verifyNoPendingRequests(http));

  async function loadPlan(actions = [first, second]): Promise<void> {
    const loading = store.load();
    http.expectOne(PLAN_URL).flush(weeklyPlanWith(actions));
    await loading;
  }

  it('loads the plan', async () => {
    expect(store.status()).toBe('loading');

    await loadPlan();

    expect(store.status()).toBe('ready');
    expect(store.plan()?.actions).toEqual([first, second]);
  });

  it('exposes error and retries', async () => {
    const failing = store.load();
    http.expectOne(PLAN_URL).flush(...failure('internal_error', 500));
    await failing;

    expect(store.status()).toBe('error');
    expect(store.plan()).toBeNull();

    await loadPlan();

    expect(store.status()).toBe('ready');
  });

  it('decide replaces the plan with the response', async () => {
    await loadPlan();

    const deciding = store.decide(first, 'done');
    const request = http.expectOne({ method: 'POST', url: DECISIONS_URL });
    expect(request.request.body).toEqual({
      candidateId: first.candidateId,
      decision: 'done',
    } satisfies WeeklyPlanDecisionRequest);
    request.flush(weeklyPlanWith([second], { doneThisWeek: 1 }));
    await deciding;

    expect(store.plan()?.actions).toEqual([second]);
    expect(store.plan()?.doneThisWeek).toBe(1);
    expect(store.justAppliedId()).toBe(first.applicationId);
    expect(store.decidingId()).toBeNull();
  });

  it('decide disables only the deciding action', async () => {
    await loadPlan();

    const deciding = store.decide(second, 'snoozed');
    expect(store.decidingId()).toBe(second.candidateId);
    expect(store.decidingId()).not.toBe(first.candidateId);
    http.expectOne(DECISIONS_URL).flush(weeklyPlanWith([first]));
    await deciding;

    expect(store.decidingId()).toBeNull();
    expect(store.justAppliedId()).toBeNull();
  });

  it('a 404 on decide reloads the plan without error', async () => {
    await loadPlan();

    const deciding = store.decide(first, 'done');
    http.expectOne(DECISIONS_URL).flush(...failure('weekly_plan_action_not_found', 404));
    await settle();
    http.expectOne({ method: 'GET', url: PLAN_URL }).flush(weeklyPlanWith([second]));
    await deciding;

    expect(store.saveFailed()).toBe(false);
    expect(store.status()).toBe('ready');
    expect(store.plan()?.actions).toEqual([second]);
  });

  it('another error on decide sets saveFailed and re-enables the action', async () => {
    await loadPlan();

    const deciding = store.decide(first, 'dismissed');
    http.expectOne(DECISIONS_URL).flush(...failure('internal_error', 500));
    await deciding;

    expect(store.saveFailed()).toBe(true);
    expect(store.decidingId()).toBeNull();
    expect(store.plan()?.actions).toEqual([first, second]);
  });
});
