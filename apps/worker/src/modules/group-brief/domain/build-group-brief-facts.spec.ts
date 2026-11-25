import type { GroupBriefFact } from '@linkvault/shared';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { buildGroupBriefFacts } from './build-group-brief-facts';
import type { UniverseOffer } from './group-brief-universe';

// asOf miércoles 2026-11-25 (semana 2026-W48, desde el lunes 23); la anterior es 2026-W47 (16 al 22 de noviembre).
const AS_OF = '2026-11-25';

function id(n: number): string {
  return n.toString(16).padStart(24, '0');
}

function offer(n: number, patch: Partial<UniverseOffer> = {}): UniverseOffer {
  return {
    id: id(n),
    sharedAt: '2026-11-24T10:00:00.000Z',
    closedAt: null,
    expiresAt: null,
    skills: [],
    ...patch,
  };
}

function build(
  offers: readonly UniverseOffer[],
): ReturnType<typeof buildGroupBriefFacts> {
  return buildGroupBriefFacts({ asOf: AS_OF, offers });
}

function fact<K extends GroupBriefFact['kind']>(
  facts: readonly GroupBriefFact[],
  kind: K,
): Extract<GroupBriefFact, { kind: K }> | undefined {
  return facts.find(
    (f): f is Extract<GroupBriefFact, { kind: K }> => f.kind === kind,
  );
}

describe('open_offers and closing_soon', () => {
  it('expiresAt before asOf is not open', () => {
    const { facts } = build([offer(1, { expiresAt: '2026-11-24' }), offer(2)]);
    expect(fact(facts, 'open_offers')?.linkIds).toEqual([id(2)]);
  });

  it('closedAt is not open', () => {
    const { facts } = build([
      offer(1, { closedAt: '2026-11-20T00:00:00.000Z' }),
      offer(2),
    ]);
    expect(fact(facts, 'open_offers')?.count).toBe(1);
  });

  it('closing window includes asOf and asOf plus seven', () => {
    const { facts } = build([
      offer(1, { expiresAt: '2026-11-25' }),
      offer(2, { expiresAt: '2026-12-02' }),
    ]);
    const closing = fact(facts, 'closing_soon');
    expect(closing?.linkIds).toEqual([id(1), id(2)]);
    expect(closing?.from).toBe('2026-11-25');
    expect(closing?.until).toBe('2026-12-02');
  });

  it('closing window excludes asOf plus eight', () => {
    const { facts } = build([offer(1, { expiresAt: '2026-12-03' })]);
    expect(fact(facts, 'closing_soon')).toBeUndefined();
  });

  it('firstExpiresAt is the earliest expiresAt', () => {
    const { facts } = build([
      offer(1, { expiresAt: '2026-12-01' }),
      offer(2, { expiresAt: '2026-11-27' }),
      offer(3, { expiresAt: '2026-11-30' }),
    ]);
    expect(fact(facts, 'closing_soon')?.firstExpiresAt).toBe('2026-11-27');
  });

  it('linkIds follow sharedAt desc then id desc', () => {
    // El universo llega ya ordenado; los hechos conservan ese orden.
    const { facts } = build([offer(3), offer(2), offer(1)]);
    expect(fact(facts, 'open_offers')?.linkIds).toEqual([id(3), id(2), id(1)]);
  });
});

describe('skill_demand', () => {
  it('Docker in four of seven offers with skills', () => {
    const offers = [
      offer(1, { skills: ['Docker'] }),
      offer(2, { skills: ['docker', 'Go'] }),
      offer(3, { skills: ['Docker '] }),
      offer(4, { skills: ['DOCKER'] }),
      offer(5, { skills: ['Rust'] }),
      offer(6, { skills: ['Java'] }),
      offer(7, { skills: ['Go'] }),
    ];
    const docker = fact(build(offers).facts, 'skill_demand');
    expect(docker).toMatchObject({
      factId: 'skill_demand:docker',
      skillKey: 'docker',
      count: 4,
      total: 7,
    });
    expect(docker?.linkIds).toEqual([id(1), id(2), id(3), id(4)]);
  });

  it('offers without skills are not in total', () => {
    const offers = [
      offer(1, { skills: ['Docker'] }),
      offer(2, { skills: ['Docker'] }),
      offer(3),
      offer(4, { skills: ['  '] }),
    ];
    const skill = fact(build(offers).facts, 'skill_demand');
    expect(skill?.count).toBe(2);
    expect(skill?.total).toBe(2);
  });

  it('a skill listed twice in one offer counts once', () => {
    const offers = [
      offer(1, { skills: ['Docker', 'docker', 'DOCKER'] }),
      offer(2, { skills: ['Go'] }),
    ];
    expect(fact(build(offers).facts, 'skill_demand')).toBeUndefined();
  });

  it('a skill in a single offer is not a fact', () => {
    const offers = [
      offer(1, { skills: ['Docker'] }),
      offer(2, { skills: ['Go'] }),
    ];
    expect(build(offers).facts.map((f) => f.kind)).toEqual(['open_offers']);
  });

  it('keeps at most five skill facts by count then key', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const offers = [
      offer(1, { skills: names }),
      offer(2, { skills: names }),
      offer(3, { skills: ['g'] }),
    ];
    const keys = build(offers).facts.flatMap((f) =>
      f.kind === 'skill_demand' ? [f.skillKey] : [],
    );
    expect(keys).toEqual(['g', 'a', 'b', 'c', 'd']);
  });

  it('label is the most frequent original form', () => {
    const offers = [
      offer(1, { skills: ['docker'] }),
      offer(2, { skills: ['Docker'] }),
      offer(3, { skills: ['Docker'] }),
    ];
    expect(fact(build(offers).facts, 'skill_demand')?.skillLabel).toBe(
      'Docker',
    );
  });
});

describe('shared_last_week and scanTruncated', () => {
  it('shared_last_week counts closed offers too', () => {
    const { facts } = build([
      offer(1, {
        sharedAt: '2026-11-18T09:00:00.000Z',
        closedAt: '2026-11-20T00:00:00.000Z',
      }),
      offer(2, { sharedAt: '2026-11-22T23:59:59.000Z' }),
    ]);
    const shared = fact(facts, 'shared_last_week');
    expect(shared?.count).toBe(2);
    expect(shared?.weekKey).toBe('2026-W47');
  });

  it('sharedAt two weeks ago is not counted', () => {
    const { facts } = build([
      offer(1, { sharedAt: '2026-11-15T23:59:59.000Z' }),
      offer(2, { sharedAt: '2026-11-23T00:00:00.000Z' }),
    ]);
    expect(fact(facts, 'shared_last_week')).toBeUndefined();
  });

  it('more than 500 relations marks scanTruncated', () => {
    const many = Array.from({ length: 501 }, (_, i) => offer(i + 1));
    const result = build(many);
    expect(result.scanTruncated).toBe(true);
    expect(fact(result.facts, 'open_offers')?.count).toBe(500);
    expect(build(many.slice(0, 500)).scanTruncated).toBe(false);
  });

  it('universe type has no member fields', () => {
    expectTypeOf<keyof UniverseOffer>().toEqualTypeOf<
      'id' | 'sharedAt' | 'closedAt' | 'expiresAt' | 'skills'
    >();
  });
});
