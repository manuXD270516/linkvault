import { describe, expect, it } from 'vitest';
import { evaluateRules } from './rules';
import type { PlanCandidateFacts } from './weekly-plan';

function facts(over: Partial<PlanCandidateFacts> = {}): PlanCandidateFacts {
  return {
    key: 'c001',
    status: 'saved',
    linkClosed: false,
    daysQuiet: 0,
    ...over,
  };
}

describe('apply_before_close', () => {
  it('saved link closing in 3 days is apply_before_close closing_soon', () => {
    const result = evaluateRules(
      facts({ expiresAt: '2026-11-28', daysUntilExpiry: 3 }),
    );
    expect(result).toEqual({
      candidateId: 'apply_before_close:c001',
      rule: 'apply_before_close',
      key: 'c001',
      reason: { kind: 'closing_soon', expiresAt: '2026-11-28', daysLeft: 3 },
    });
  });

  it('closing today has daysLeft 0', () => {
    const result = evaluateRules(
      facts({
        status: 'interested',
        expiresAt: '2026-11-25',
        daysUntilExpiry: 0,
      }),
    );
    expect(result?.reason).toEqual({
      kind: 'closing_soon',
      expiresAt: '2026-11-25',
      daysLeft: 0,
    });
  });

  it('expiresAt yesterday without closedAt is not closing_soon', () => {
    const result = evaluateRules(
      facts({ expiresAt: '2026-11-24', daysUntilExpiry: -1 }),
    );
    expect(result).toBeNull();
  });

  it('expired with fit 80 yields no apply action', () => {
    const result = evaluateRules(
      facts({
        expiresAt: '2026-11-24',
        daysUntilExpiry: -1,
        fit: { score: 80, degraded: false },
      }),
    );
    expect(result).toBeNull();
  });

  it('interested with non-degraded fit 80 and no expiresAt is high_fit', () => {
    const result = evaluateRules(
      facts({ status: 'interested', fit: { score: 80, degraded: false } }),
    );
    expect(result?.rule).toBe('apply_before_close');
    expect(result?.reason).toEqual({ kind: 'high_fit', score: 80 });
  });

  it('degraded fit does not count as high_fit', () => {
    const result = evaluateRules(
      facts({ status: 'interested', fit: { score: 90, degraded: true } }),
    );
    expect(result).toBeNull();
  });

  it('a far expiry with high fit falls back to high_fit', () => {
    const result = evaluateRules(
      facts({
        expiresAt: '2026-12-20',
        daysUntilExpiry: 25,
        fit: { score: 75, degraded: false },
      }),
    );
    expect(result?.reason).toEqual({ kind: 'high_fit', score: 75 });
  });

  it('fit under 75 is not high_fit', () => {
    expect(
      evaluateRules(facts({ fit: { score: 74, degraded: false } })),
    ).toBeNull();
  });
});

describe('follow_up and ask_know_someone', () => {
  it('applied quiet 12 days is follow_up', () => {
    const result = evaluateRules(
      facts({
        status: 'applied',
        daysQuiet: 12,
        appliedAt: '2026-11-01T00:00:00.000Z',
      }),
    );
    expect(result?.rule).toBe('follow_up');
    expect(result?.reason).toEqual({
      kind: 'quiet',
      daysQuiet: 12,
      status: 'applied',
      appliedAt: '2026-11-01T00:00:00.000Z',
    });
  });

  it('applied quiet 9 days yields nothing', () => {
    expect(
      evaluateRules(facts({ status: 'applied', daysQuiet: 9 })),
    ).toBeNull();
  });

  it('saved quiet 30 days without signals yields nothing', () => {
    expect(evaluateRules(facts({ status: 'saved', daysQuiet: 30 }))).toBeNull();
  });

  it('closed link yields nothing', () => {
    expect(
      evaluateRules(
        facts({ status: 'applied', daysQuiet: 15, linkClosed: true }),
      ),
    ).toBeNull();
  });

  it('own flag alone does not count for ask_know_someone', () => {
    // La fachada ya descuenta a quien pregunta: sin marcas ajenas no hay `knowSomeone`.
    expect(evaluateRules(facts({ status: 'applied' }))).toBeNull();
    expect(
      evaluateRules(
        facts({ status: 'applied', knowSomeone: { count: 0, groupId: 'g1' } }),
      ),
    ).toBeNull();
  });

  it('applied with a know-someone count is ask_know_someone', () => {
    const result = evaluateRules(
      facts({ status: 'applied', knowSomeone: { count: 2, groupId: 'g2' } }),
    );
    expect(result?.reason).toEqual({
      kind: 'know_someone',
      count: 2,
      groupId: 'g2',
    });
  });

  it('one candidate per application, first rule wins', () => {
    const know = { count: 1, groupId: 'g1' };
    expect(
      evaluateRules(
        facts({
          expiresAt: '2026-11-28',
          daysUntilExpiry: 3,
          knowSomeone: know,
        }),
      )?.rule,
    ).toBe('apply_before_close');
    expect(
      evaluateRules(
        facts({ status: 'in_process', daysQuiet: 20, knowSomeone: know }),
      )?.rule,
    ).toBe('follow_up');
  });

  it('offer and rejected states yield nothing', () => {
    const know = { count: 3, groupId: 'g1' };
    expect(
      evaluateRules(facts({ status: 'offer', daysQuiet: 40, knowSomeone: know })),
    ).toBeNull();
    expect(
      evaluateRules(facts({ status: 'rejected', knowSomeone: know })),
    ).toBeNull();
  });
});
