import { describe, expect, it } from 'vitest';
import {
  weeklyPlanDecisionRequestSchema,
  weeklyPlanResponseSchema,
  type WeeklyPlanAction,
} from './weekly-plan.schema';

const LINK = { displayUrl: 'https://example.com/jobs/1', title: 'Dev' };

function action(
  over: Partial<WeeklyPlanAction> & Pick<WeeklyPlanAction, 'reason' | 'rule'>,
): WeeklyPlanAction {
  return {
    candidateId: `${over.rule}:66e9a0000000000000000001`,
    applicationId: '66e9a0000000000000000001',
    linkId: '66e9a0000000000000000002',
    link: LINK,
    ...over,
  };
}

const CLOSING = action({
  rule: 'apply_before_close',
  reason: { kind: 'closing_soon', expiresAt: '2026-12-01', daysLeft: 3 },
});
const QUIET = action({
  rule: 'follow_up',
  reason: { kind: 'quiet', daysQuiet: 12, status: 'applied' },
});
const KNOW = action({
  rule: 'ask_know_someone',
  reason: { kind: 'know_someone', count: 2, groupId: 'g2' },
});

function plan(actions: unknown[]) {
  return { weekKey: '2026-W48', planner: 'rules', actions, doneThisWeek: 0 };
}

describe('weeklyPlanResponseSchema', () => {
  it('accepts a plan with three actions of each rule', () => {
    const result = weeklyPlanResponseSchema.safeParse(
      plan([CLOSING, QUIET, KNOW]),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a plan with four actions', () => {
    const result = weeklyPlanResponseSchema.safeParse(
      plan([CLOSING, QUIET, KNOW, CLOSING]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects an unknown reason kind', () => {
    const result = weeklyPlanResponseSchema.safeParse(
      plan([{ ...CLOSING, reason: { kind: 'missing_skill' } }]),
    );
    expect(result.success).toBe(false);
  });

  it('rejects a quiet reason under ten days', () => {
    const result = weeklyPlanResponseSchema.safeParse(
      plan([
        { ...QUIET, reason: { kind: 'quiet', daysQuiet: 9, status: 'applied' } },
      ]),
    );
    expect(result.success).toBe(false);
  });

  it('accepts closing_soon with daysLeft 0', () => {
    const result = weeklyPlanResponseSchema.safeParse(
      plan([
        {
          ...CLOSING,
          reason: { kind: 'closing_soon', expiresAt: '2026-11-25', daysLeft: 0 },
        },
      ]),
    );
    expect(result.success).toBe(true);
  });

  it('rejects extra fields in an action', () => {
    const result = weeklyPlanResponseSchema.safeParse(
      plan([{ ...CLOSING, flaggedBy: ['u1'] }]),
    );
    expect(result.success).toBe(false);
  });
});

describe('weeklyPlanDecisionRequestSchema', () => {
  it('decision request accepts done, dismissed and snoozed only', () => {
    for (const decision of ['done', 'dismissed', 'snoozed']) {
      expect(
        weeklyPlanDecisionRequestSchema.safeParse({
          candidateId: 'follow_up:abc',
          decision,
        }).success,
      ).toBe(true);
    }
    expect(
      weeklyPlanDecisionRequestSchema.safeParse({
        candidateId: 'follow_up:abc',
        decision: 'applied',
      }).success,
    ).toBe(false);
  });
});
