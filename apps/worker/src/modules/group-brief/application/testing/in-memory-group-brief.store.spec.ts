import { describe, expect, it } from 'vitest';
import { toDocument } from '../../infrastructure/persistence/group-weekly-brief.document';
import { InMemoryGroupBriefStore } from './in-memory-group-brief.store';

const G1 = '1'.repeat(24);
const G2 = '2'.repeat(24);
const LINK = 'a'.repeat(24);

function document(groupId: string, weekKey: string, count: number) {
  return toDocument({
    version: 1,
    groupId,
    weekKey,
    asOf: '2026-11-25',
    computedAt: '2026-11-25T05:00:00.000Z',
    scanTruncated: false,
    facts: [
      {
        kind: 'open_offers',
        factId: 'open_offers',
        count,
        linkIds: Array.from({ length: count }, () => LINK),
      },
    ],
    bullets: [{ factId: 'open_offers', source: 'template' }],
  });
}

describe('InMemoryGroupBriefStore', () => {
  it('replace keeps a single brief per group and week', async () => {
    const store = new InMemoryGroupBriefStore();
    await store.replace(document(G1, '2026-W48', 1));
    await store.replace(document(G1, '2026-W48', 2));
    expect(store.documents.size).toBe(1);
    expect(store.get(G1, '2026-W48')?.facts[0]?.count).toBe(2);
  });

  it('clear removes only that group and week', async () => {
    const store = new InMemoryGroupBriefStore();
    await store.replace(document(G1, '2026-W48', 1));
    await store.replace(document(G1, '2026-W47', 1));
    await store.replace(document(G2, '2026-W48', 1));
    await store.clear(G1, '2026-W48');
    expect(store.get(G1, '2026-W48')).toBeUndefined();
    expect(store.get(G1, '2026-W47')).toBeDefined();
    expect(store.get(G2, '2026-W48')).toBeDefined();
  });
});
