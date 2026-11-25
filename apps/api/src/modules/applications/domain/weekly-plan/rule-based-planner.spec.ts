import { WEEKLY_PLAN_MAX_ACTIONS } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { RuleBasedPlanner } from './rule-based-planner';
import type {
  PlanCandidateFacts,
  PlanDecisionFact,
  WeeklyPlanInput,
} from './weekly-plan';

const planner = new RuleBasedPlanner();

function quiet(key: string, daysQuiet = 12): PlanCandidateFacts {
  return { key, status: 'applied', linkClosed: false, daysQuiet };
}

function closing(key: string, daysLeft: number): PlanCandidateFacts {
  return {
    key,
    status: 'saved',
    linkClosed: false,
    daysQuiet: 0,
    expiresAt: '2026-11-30',
    daysUntilExpiry: daysLeft,
  };
}

function know(key: string, count = 1): PlanCandidateFacts {
  return {
    key,
    status: 'saved',
    linkClosed: false,
    daysQuiet: 0,
    knowSomeone: { count, groupId: 'g1' },
  };
}

function input(
  candidates: PlanCandidateFacts[],
  over: Partial<WeeklyPlanInput> = {},
): WeeklyPlanInput {
  return {
    today: '2026-11-25',
    weekKey: '2026-W48',
    candidates,
    decisions: [],
    ...over,
  };
}

function decision(
  candidateId: string,
  kind: PlanDecisionFact['decision'],
  weekKey: string,
): PlanDecisionFact {
  return { candidateId, decision: kind, weekKey };
}

async function ids(i: WeeklyPlanInput): Promise<string[]> {
  return (await planner.plan(i)).actions.map((a) => a.candidateId);
}

describe('RuleBasedPlanner', () => {
  it('caps at three actions', async () => {
    const outcome = await planner.plan(
      input([quiet('c1'), quiet('c2'), quiet('c3'), quiet('c4'), quiet('c5')]),
    );
    expect(outcome.actions).toHaveLength(WEEKLY_PLAN_MAX_ACTIONS);
    expect(outcome.actions).toHaveLength(3);
    expect(outcome.eligible).toHaveLength(5);
  });

  it('round-robins one per rule before repeating', async () => {
    expect(
      await ids(input([quiet('c1', 30), quiet('c2', 20), know('c3')])),
    ).toEqual(['follow_up:c1', 'ask_know_someone:c3', 'follow_up:c2']);
  });

  it('orders inside each rule and breaks ties by key', async () => {
    expect(
      await ids(input([closing('c3', 5), closing('c2', 1), closing('c1', 5)])),
    ).toEqual([
      'apply_before_close:c2',
      'apply_before_close:c1',
      'apply_before_close:c3',
    ]);
    expect(
      await ids(input([quiet('c2', 12), quiet('c1', 12), quiet('c3', 40)])),
    ).toEqual(['follow_up:c3', 'follow_up:c1', 'follow_up:c2']);
  });

  it('closing_soon goes before high_fit inside apply_before_close', async () => {
    const fit: PlanCandidateFacts = {
      key: 'c1',
      status: 'interested',
      linkClosed: false,
      daysQuiet: 0,
      fit: { score: 95, degraded: false },
    };
    expect(await ids(input([fit, closing('c2', 6)]))).toEqual([
      'apply_before_close:c2',
      'apply_before_close:c1',
    ]);
  });

  it('snoozed hides only its own week', async () => {
    const decisions = [decision('follow_up:c1', 'snoozed', '2026-W48')];
    const inWeek = (weekKey: string) =>
      ids(input([quiet('c1')], { weekKey, decisions }));
    expect(await inWeek('2026-W48')).toEqual([]);
    expect(await inWeek('2026-W49')).toEqual(['follow_up:c1']);
  });

  it('done hides its week and the next one', async () => {
    const decisions = [decision('follow_up:c1', 'done', '2026-W48')];
    const inWeek = (weekKey: string) =>
      ids(input([quiet('c1')], { weekKey, decisions }));
    expect(await inWeek('2026-W48')).toEqual([]);
    expect(await inWeek('2026-W49')).toEqual([]);
    expect(await inWeek('2026-W50')).toEqual(['follow_up:c1']);
  });

  it('dismissed hides for 35 days', async () => {
    // El repositorio solo entrega decisiones de menos de 35 días: mientras llegue, oculta en cualquier semana.
    const decisions = [decision('follow_up:c1', 'dismissed', '2026-W48')];
    for (const weekKey of ['2026-W48', '2026-W49', '2026-W50', '2026-W52']) {
      expect(await ids(input([quiet('c1')], { weekKey, decisions }))).toEqual(
        [],
      );
    }
  });

  it('fills the slot of a hidden action with the next candidate', async () => {
    const decisions = [decision('follow_up:c1', 'dismissed', '2026-W48')];
    const outcome = await planner.plan(
      input([quiet('c1', 40), quiet('c2'), quiet('c3'), quiet('c4')], {
        decisions,
      }),
    );
    expect(outcome.actions.map((a) => a.candidateId)).toEqual([
      'follow_up:c2',
      'follow_up:c3',
      'follow_up:c4',
    ]);
    expect(outcome.eligible.map((a) => a.candidateId)).toContain(
      'follow_up:c1',
    );
  });

  it('a decision on another rule of the same application does not hide the candidate', async () => {
    const decisions = [
      decision('apply_before_close:c1', 'dismissed', '2026-W48'),
    ];
    expect(await ids(input([quiet('c1')], { decisions }))).toEqual([
      'follow_up:c1',
    ]);
  });

  it('same input yields the same output', async () => {
    const i = input([quiet('c1'), know('c2'), closing('c3', 2), quiet('c4')]);
    expect(await planner.plan(i)).toEqual(await planner.plan(i));
  });

  it('returns an empty plan when nothing applies', async () => {
    const outcome = await planner.plan(input([]));
    expect(outcome).toEqual({ planner: 'rules', actions: [], eligible: [] });
  });
});
