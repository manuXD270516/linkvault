import { describe, expect, it } from 'vitest';
import {
  groupBriefFactViewSchema,
  groupBriefOfferSchema,
  groupWeeklyBriefResponseSchema,
  groupWeeklyBriefSchema,
} from './group-weekly-brief.schema';

const ID_A = 'a'.repeat(24);
const ID_B = 'b'.repeat(24);
const ID_C = 'c'.repeat(24);

type Raw = Record<string, unknown>;

function validBrief(): Raw & { facts: Raw[]; bullets: Raw[] } {
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
        linkIds: [ID_C],
        weekKey: '2026-W47',
      },
    ],
    bullets: [
      { factId: 'closing_soon', source: 'template' },
      { factId: 'skill_demand:docker', source: 'template' },
    ],
  };
}

describe('groupWeeklyBriefSchema', () => {
  it('accepts a brief with one fact of each kind', () => {
    expect(groupWeeklyBriefSchema.safeParse(validBrief()).success).toBe(true);
  });

  it('rejects five bullets', () => {
    const brief = validBrief();
    brief.bullets = Array.from({ length: 5 }, (_, i) => ({
      factId: `f${i}`,
      source: 'template',
    }));
    expect(groupWeeklyBriefSchema.safeParse(brief).success).toBe(false);
  });

  it('rejects a closed_last_week fact', () => {
    const brief = validBrief();
    brief.facts.push({
      kind: 'closed_last_week',
      factId: 'closed_last_week',
      count: 1,
      linkIds: [ID_A],
    });
    expect(groupWeeklyBriefSchema.safeParse(brief).success).toBe(false);
  });

  it('closing fact requires firstExpiresAt', () => {
    const brief = validBrief();
    const closing = { ...brief.facts[1] };
    delete closing['firstExpiresAt'];
    brief.facts[1] = closing;
    expect(groupWeeklyBriefSchema.safeParse(brief).success).toBe(false);
  });

  it('rejects a skill fact with count 1', () => {
    const brief = validBrief();
    brief.facts[2] = { ...brief.facts[2], count: 1 };
    expect(groupWeeklyBriefSchema.safeParse(brief).success).toBe(false);
  });

  it('rejects a member id field in a fact', () => {
    const brief = validBrief();
    brief.facts[0] = { ...brief.facts[0], sharedBy: ID_A };
    expect(groupWeeklyBriefSchema.safeParse(brief).success).toBe(false);
  });

  it('rejects a malformed linkId', () => {
    const brief = validBrief();
    brief.facts[0] = { ...brief.facts[0], linkIds: ['not-an-id'] };
    expect(groupWeeklyBriefSchema.safeParse(brief).success).toBe(false);
  });
});

describe('group weekly brief view and response', () => {
  it('view of each kind has no linkIds', () => {
    const views: Raw[] = [
      {
        kind: 'closing_soon',
        count: 1,
        from: '2026-11-25',
        until: '2026-12-02',
        firstExpiresAt: '2026-11-27',
      },
      { kind: 'skill_demand', skillLabel: 'Docker', count: 2, total: 3 },
      { kind: 'shared_last_week', count: 1, weekKey: '2026-W47' },
    ];
    for (const view of views) {
      expect(groupBriefFactViewSchema.safeParse(view).success).toBe(true);
      expect(
        groupBriefFactViewSchema.safeParse({ ...view, linkIds: [ID_A] })
          .success,
      ).toBe(false);
    }
  });

  it('view rejects open_offers', () => {
    expect(
      groupBriefFactViewSchema.safeParse({ kind: 'open_offers', count: 3 })
        .success,
    ).toBe(false);
  });

  it('offer accepts an optional expiresAt', () => {
    const base = { linkId: ID_A, displayUrl: 'example.com/job' };
    expect(groupBriefOfferSchema.safeParse(base).success).toBe(true);
    expect(
      groupBriefOfferSchema.safeParse({ ...base, expiresAt: '2026-11-27' })
        .success,
    ).toBe(true);
  });

  it('response accepts brief null', () => {
    expect(
      groupWeeklyBriefResponseSchema.safeParse({
        weekKey: '2026-W48',
        brief: null,
      }).success,
    ).toBe(true);
  });

  it('response rejects scanTruncated', () => {
    expect(
      groupWeeklyBriefResponseSchema.safeParse({
        weekKey: '2026-W48',
        brief: null,
        scanTruncated: false,
      }).success,
    ).toBe(false);
  });
});
