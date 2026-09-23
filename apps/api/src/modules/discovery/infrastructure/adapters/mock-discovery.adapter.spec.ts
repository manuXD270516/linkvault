import { describe, expect, it } from 'vitest';
import {
  MOCK_GETONBOARD_HITS,
  MOCK_REMOTEOK_HITS,
  MockDiscoveryAdapter,
  mockDiscoveryAdapters,
} from './mock-discovery.adapter';

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe('MockDiscoveryAdapter', () => {
  it('registers getonboard and remoteok from fixtures', () => {
    const adapters = mockDiscoveryAdapters();
    expect(adapters.map((a) => a.id)).toEqual(['getonboard', 'remoteok']);
  });

  it('returns first pageSize hits when q is empty', async () => {
    const adapter = new MockDiscoveryAdapter(
      'getonboard',
      MOCK_GETONBOARD_HITS,
    );
    const result = await adapter.search({
      q: '',
      page: 1,
      pageSize: 2,
      lang: 'es',
      signal: signal(),
    });
    expect(result).toEqual({
      kind: 'hits',
      hits: MOCK_GETONBOARD_HITS.slice(0, 2),
    });
  });

  it('filters by title case-insensitively and paginates', async () => {
    const adapter = new MockDiscoveryAdapter('remoteok', MOCK_REMOTEOK_HITS);
    const result = await adapter.search({
      q: 'react',
      page: 1,
      pageSize: 10,
      lang: 'en',
      signal: signal(),
    });
    expect(result.kind).toBe('hits');
    if (result.kind === 'hits') {
      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]?.externalJobId).toBe('99001');
    }
  });
});
