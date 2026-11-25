import { describe, expect, it } from 'vitest';
import {
  groupWeeklyBriefSchema,
  type GroupBriefFact,
  type GroupWeeklyBrief,
} from '../schemas/group-weekly-brief.schema';
import {
  verifyGroupWeeklyBrief,
  type GroupBriefViolationCode,
} from './verify-group-weekly-brief';

const ID_A = 'a'.repeat(24);
const ID_B = 'b'.repeat(24);
const ID_C = 'c'.repeat(24);
const ID_D = 'd'.repeat(24);

function validBrief(): GroupWeeklyBrief {
  return {
    version: 1,
    groupId: '1'.repeat(24),
    weekKey: '2026-W48',
    asOf: '2026-11-25',
    computedAt: '2026-11-25T05:00:00.000Z',
    scanTruncated: false,
    facts: [
      {
        kind: 'open_offers',
        factId: 'open_offers',
        count: 3,
        linkIds: [ID_A, ID_B, ID_C],
      },
      {
        kind: 'closing_soon',
        factId: 'closing_soon',
        count: 1,
        linkIds: [ID_A],
        from: '2026-11-25',
        until: '2026-12-02',
        firstExpiresAt: '2026-11-27',
      },
      {
        kind: 'skill_demand',
        factId: 'skill_demand:docker',
        skillKey: 'docker',
        skillLabel: 'Docker',
        count: 2,
        total: 3,
        linkIds: [ID_A, ID_B],
      },
      {
        kind: 'shared_last_week',
        factId: 'shared_last_week',
        count: 1,
        linkIds: [ID_D],
        weekKey: '2026-W47',
      },
    ],
    bullets: [
      { factId: 'closing_soon', source: 'template' },
      { factId: 'skill_demand:docker', source: 'template' },
    ],
  };
}

function withFact(
  brief: GroupWeeklyBrief,
  index: number,
  patch: Record<string, unknown>,
): GroupWeeklyBrief {
  const facts = brief.facts.map((f, i) =>
    i === index ? ({ ...f, ...patch } as GroupBriefFact) : f,
  );
  return { ...brief, facts };
}

function codesOf(brief: GroupWeeklyBrief): readonly GroupBriefViolationCode[] {
  const verdict = verifyGroupWeeklyBrief(brief);
  return verdict.ok ? [] : verdict.violations.map((v) => v.code);
}

describe('verifyGroupWeeklyBrief', () => {
  it('valid brief passes', () => {
    const brief = validBrief();
    expect(groupWeeklyBriefSchema.safeParse(brief).success).toBe(true);
    expect(verifyGroupWeeklyBrief(brief)).toEqual({ ok: true });
  });

  it('bullet citing a missing fact fails with bullet_fact_missing', () => {
    const brief = {
      ...validBrief(),
      bullets: [{ factId: 'skill_demand:rust', source: 'template' as const }],
    };
    expect(codesOf(brief)).toEqual(['bullet_fact_missing']);
  });

  it('bullet citing open_offers fails with bullet_cites_open_offers', () => {
    const brief = {
      ...validBrief(),
      bullets: [{ factId: 'open_offers', source: 'template' as const }],
    };
    expect(codesOf(brief)).toEqual(['bullet_cites_open_offers']);
  });

  it('count different from linkIds fails with count_mismatch', () => {
    expect(codesOf(withFact(validBrief(), 1, { count: 2 }))).toEqual([
      'count_mismatch',
    ]);
  });

  it('skill link outside open offers fails with not_subset_of_open', () => {
    expect(
      codesOf(withFact(validBrief(), 2, { linkIds: [ID_A, ID_D] })),
    ).toEqual(['not_subset_of_open']);
  });

  it('closing until not asOf plus seven fails', () => {
    expect(codesOf(withFact(validBrief(), 1, { until: '2026-12-03' }))).toEqual(
      ['closing_window_invalid'],
    );
  });

  it('firstExpiresAt after until fails with closing_window_invalid', () => {
    expect(
      codesOf(withFact(validBrief(), 1, { firstExpiresAt: '2026-12-03' })),
    ).toEqual(['closing_window_invalid']);
  });

  it('shared_last_week of another week fails', () => {
    expect(codesOf(withFact(validBrief(), 3, { weekKey: '2026-W46' }))).toEqual(
      ['previous_week_invalid'],
    );
  });

  it('shared_last_week across a year boundary passes', () => {
    const brief = withFact(validBrief(), 3, { weekKey: '2026-W53' });
    expect(codesOf({ ...brief, weekKey: '2027-W01' })).toEqual([]);
  });

  it('skill total above open offers fails with skill_total_invalid', () => {
    expect(codesOf(withFact(validBrief(), 2, { total: 4 }))).toEqual([
      'skill_total_invalid',
    ]);
  });

  it('missing open_offers fails with open_offers_missing', () => {
    const brief = validBrief();
    const facts = brief.facts.filter((f) => f.kind !== 'open_offers');
    expect(codesOf({ ...brief, facts })).toContain('open_offers_missing');
  });

  it('repeated factId fails with duplicate_fact_id', () => {
    const brief = validBrief();
    const facts = [...brief.facts, brief.facts[1]];
    expect(codesOf({ ...brief, facts })).toContain('duplicate_fact_id');
  });

  it('factId of another skill fails with fact_id_kind_mismatch', () => {
    expect(
      codesOf(withFact(validBrief(), 2, { factId: 'skill_demand:rust' })),
    ).toContain('fact_id_kind_mismatch');
  });

  it('repeated bullet fails with duplicate_bullet', () => {
    const brief = validBrief();
    const bullets = [brief.bullets[0], brief.bullets[0]];
    expect(codesOf({ ...brief, bullets })).toEqual(['duplicate_bullet']);
  });

  it('repeated linkId fails with duplicate_link_id', () => {
    expect(
      codesOf(withFact(validBrief(), 2, { linkIds: [ID_A, ID_A] })),
    ).toEqual(['duplicate_link_id']);
  });

  it('five bullets fail with too_many_bullets', () => {
    const brief = validBrief();
    const bullets = Array.from({ length: 5 }, () => brief.bullets[0]);
    expect(codesOf({ ...brief, bullets })).toContain('too_many_bullets');
  });

  it('three skill bullets fail with too_many_skill_bullets', () => {
    const brief = validBrief();
    const skill = (key: string): GroupBriefFact => ({
      kind: 'skill_demand',
      factId: `skill_demand:${key}`,
      skillKey: key,
      skillLabel: key,
      count: 2,
      total: 3,
      linkIds: [ID_A, ID_B],
    });
    const facts = [...brief.facts, skill('rust'), skill('go')];
    const bullets = [
      { factId: 'skill_demand:docker', source: 'template' as const },
      { factId: 'skill_demand:rust', source: 'template' as const },
      { factId: 'skill_demand:go', source: 'template' as const },
    ];
    expect(codesOf({ ...brief, facts, bullets })).toEqual([
      'too_many_skill_bullets',
    ]);
  });
});
