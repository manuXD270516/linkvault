import {
  groupWeeklyBriefSchema,
  verifyGroupWeeklyBrief,
  type GroupBriefFact,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { computeGroupBrief } from './compute-group-brief';
import type { UniverseOffer } from './group-brief-universe';
import { selectGroupBriefBullets } from './select-group-brief-bullets';

const IDS = ['a', 'b'].map((c) => c.repeat(24));

const OPEN: GroupBriefFact = {
  kind: 'open_offers',
  factId: 'open_offers',
  count: 2,
  linkIds: IDS,
};
const CLOSING: GroupBriefFact = {
  kind: 'closing_soon',
  factId: 'closing_soon',
  count: 1,
  linkIds: [IDS[0] ?? ''],
  from: '2026-11-25',
  until: '2026-12-02',
  firstExpiresAt: '2026-11-27',
};
const SHARED: GroupBriefFact = {
  kind: 'shared_last_week',
  factId: 'shared_last_week',
  count: 1,
  linkIds: [IDS[1] ?? ''],
  weekKey: '2026-W47',
};

function skill(key: string): GroupBriefFact {
  return {
    kind: 'skill_demand',
    factId: `skill_demand:${key}`,
    skillKey: key,
    skillLabel: key,
    count: 2,
    total: 2,
    linkIds: IDS,
  };
}

function ids(facts: readonly GroupBriefFact[]): readonly string[] {
  return selectGroupBriefBullets(facts).map((b) => b.factId);
}

describe('selectGroupBriefBullets', () => {
  it('orders closing, skill, shared, second skill', () => {
    const facts = [OPEN, CLOSING, skill('docker'), skill('go'), SHARED];
    expect(ids(facts)).toEqual([
      'closing_soon',
      'skill_demand:docker',
      'shared_last_week',
      'skill_demand:go',
    ]);
  });

  it('caps at four bullets', () => {
    const facts = [
      OPEN,
      CLOSING,
      skill('a'),
      skill('b'),
      skill('c'),
      skill('d'),
      SHARED,
    ];
    expect(ids(facts)).toHaveLength(4);
  });

  it('at most two skill bullets', () => {
    const facts = [OPEN, skill('a'), skill('b'), skill('c'), skill('d')];
    expect(ids(facts)).toEqual(['skill_demand:a', 'skill_demand:b']);
  });

  it('only skills yields one bullet', () => {
    expect(ids([OPEN, skill('docker')])).toEqual(['skill_demand:docker']);
  });

  it('no facts yields no bullets', () => {
    expect(ids([])).toEqual([]);
    expect(ids([OPEN])).toEqual([]);
  });

  it('bullets are template citations without text of their own', () => {
    expect(selectGroupBriefBullets([OPEN, CLOSING])).toEqual([
      { factId: 'closing_soon', source: 'template' },
    ]);
  });
});

/** PRNG sembrado (mulberry32): los universos son los mismos en cada corrida. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = new Date('2026-11-25T05:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const SKILL_POOL = ['Docker', 'docker', 'TypeScript', 'Go', 'SQL', 'Rust', ' '];

function randomUniverse(random: () => number): UniverseOffer[] {
  const size = Math.floor(random() * 40);
  const offers: UniverseOffer[] = [];
  for (let i = 0; i < size; i += 1) {
    const sharedAt = new Date(NOW.getTime() - random() * 20 * DAY_MS);
    const expiresRoll = random();
    offers.push({
      id: (i + 1).toString(16).padStart(24, '0'),
      sharedAt: sharedAt.toISOString(),
      closedAt: random() < 0.2 ? sharedAt.toISOString() : null,
      expiresAt:
        expiresRoll < 0.4
          ? null
          : new Date(NOW.getTime() + (random() * 24 - 8) * DAY_MS)
              .toISOString()
              .slice(0, 10),
      skills: Array.from(
        { length: Math.floor(random() * 4) },
        () => SKILL_POOL[Math.floor(random() * SKILL_POOL.length)] ?? 'Go',
      ),
    });
  }
  return offers.sort((a, b) =>
    a.sharedAt !== b.sharedAt
      ? b.sharedAt.localeCompare(a.sharedAt)
      : b.id.localeCompare(a.id),
  );
}

describe('computeGroupBrief', () => {
  it('same universe and clock yield identical output', () => {
    const offers = randomUniverse(prng(7));
    const input = { groupId: '1'.repeat(24), now: NOW, offers };
    expect(computeGroupBrief(input)).toEqual(computeGroupBrief(input));
  });

  it('every computed brief passes the verifier', () => {
    const random = prng(20261125);
    let computed = 0;
    for (let run = 0; run < 200; run += 1) {
      const brief = computeGroupBrief({
        groupId: '1'.repeat(24),
        now: NOW,
        offers: randomUniverse(random),
      });
      if (brief === null) continue;
      computed += 1;
      expect(groupWeeklyBriefSchema.safeParse(brief).success).toBe(true);
      expect(verifyGroupWeeklyBrief(brief)).toEqual({ ok: true });
    }
    expect(computed).toBeGreaterThan(50);
  });

  it('a universe with no bullets yields null', () => {
    expect(
      computeGroupBrief({ groupId: '1'.repeat(24), now: NOW, offers: [] }),
    ).toBeNull();
  });
});
