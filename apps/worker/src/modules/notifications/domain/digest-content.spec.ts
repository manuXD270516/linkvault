import { describe, expect, it } from 'vitest';
import {
  aggregateDigestLinks,
  digestHasContent,
  type DigestLinkRow,
} from './digest-content';

const T0 = new Date('2026-09-15T10:00:00.000Z');
const T1 = new Date('2026-09-16T10:00:00.000Z');
const T2 = new Date('2026-09-17T10:00:00.000Z');

describe('aggregateDigestLinks', () => {
  it('vacío → sin contenido', () => {
    const agg = aggregateDigestLinks([]);
    expect(agg.items).toEqual([]);
    expect(agg.moreCount).toBe(0);
    expect(digestHasContent(agg)).toBe(false);
  });

  it('ordena por sharedAt desc y limita a 10', () => {
    const rows: DigestLinkRow[] = [];
    for (let i = 0; i < 15; i += 1) {
      rows.push({
        linkId: `l${i}`,
        sharedAt: new Date(T0.getTime() + i * 60_000),
        title: `Title ${i}`,
      });
    }
    const agg = aggregateDigestLinks(rows);
    expect(agg.items).toHaveLength(10);
    expect(agg.items[0]?.title).toBe('Title 14');
    expect(agg.items[9]?.title).toBe('Title 5');
    expect(agg.moreCount).toBe(5);
    expect(digestHasContent(agg)).toBe(true);
  });

  it('no incluye nota (el agregador solo ve title)', () => {
    const rows: DigestLinkRow[] = [
      {
        linkId: 'l1',
        sharedAt: T1,
        title: 'Backend eng',
      },
      {
        linkId: 'l2',
        sharedAt: T2,
        title: 'Frontend eng',
      },
    ];
    const agg = aggregateDigestLinks(rows);
    const body = agg.items.map((i) => i.title).join('\n');
    expect(body).not.toContain('secreta');
    expect(body).toContain('Frontend eng');
    expect(agg.items[0]?.sharedAt).toEqual(T2);
  });

  it('omite títulos vacíos del listado', () => {
    const agg = aggregateDigestLinks([
      { linkId: 'l1', sharedAt: T0, title: null },
      { linkId: 'l2', sharedAt: T1, title: '  ' },
      { linkId: 'l3', sharedAt: T2, title: 'Ok' },
    ]);
    expect(agg.items).toHaveLength(1);
    expect(agg.items[0]?.title).toBe('Ok');
    expect(agg.totalInWindow).toBe(3);
  });
});
