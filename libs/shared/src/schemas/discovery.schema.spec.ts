import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_BOARDS,
  DISCOVERY_DEGRADE_REASONS,
  DISCOVERY_PAGE_SIZE_DEFAULT,
  DISCOVERY_PAGE_SIZE_MAX,
  discoveryHitSchema,
  discoverySearchQuerySchema,
  discoverySearchResponseSchema,
} from './discovery.schema';

function issuePaths(result: {
  error?: { issues: readonly { path: readonly PropertyKey[] }[] };
}): string[] {
  return [
    ...new Set(
      (result.error?.issues ?? []).map((issue) => issue.path.join('.')),
    ),
  ].sort();
}

describe('discoverySearchQuerySchema', () => {
  it('defaults q empty, board all, page 1, pageSize 10', () => {
    expect(discoverySearchQuerySchema.parse({})).toEqual({
      q: '',
      board: 'all',
      page: 1,
      pageSize: DISCOVERY_PAGE_SIZE_DEFAULT,
    });
  });

  it('accepts getonboard and remoteok boards', () => {
    expect(
      discoverySearchQuerySchema.parse({
        q: 'react',
        board: 'getonboard',
        page: '2',
        pageSize: '5',
      }),
    ).toEqual({
      q: 'react',
      board: 'getonboard',
      page: 2,
      pageSize: 5,
    });
    expect(DISCOVERY_BOARDS).toEqual(['getonboard', 'remoteok', 'all']);
  });

  it('rejects pageSize above cap and invalid board', () => {
    expect(
      issuePaths(
        discoverySearchQuerySchema.safeParse({
          pageSize: String(DISCOVERY_PAGE_SIZE_MAX + 1),
        }),
      ),
    ).toEqual(['pageSize']);
    expect(
      issuePaths(discoverySearchQuerySchema.safeParse({ board: 'linkedin' })),
    ).toEqual(['board']);
  });
});

describe('discoveryHitSchema and response', () => {
  const hit = {
    board: 'getonboard',
    title: 'Backend Engineer',
    url: 'https://www.getonbrd.com/jobs/backend-engineer-acme-remote-ab12',
    externalJobId: 'backend-engineer-acme-remote-ab12',
    company: 'Acme',
  } as const;

  it('accepts a minimal hit and optional fields', () => {
    expect(discoveryHitSchema.parse(hit)).toEqual(hit);
    expect(
      discoveryHitSchema.parse({
        ...hit,
        location: 'Santiago',
        salaryText: 'USD 3k–5k',
      }),
    ).toMatchObject({ location: 'Santiago', salaryText: 'USD 3k–5k' });
  });

  it('lists closed degrade reasons and accepts degraded response', () => {
    expect(DISCOVERY_DEGRADE_REASONS).toEqual([
      'timeout',
      'upstream_429',
      'upstream_5xx',
      'egress_limited',
      'network',
    ]);
    expect(
      discoverySearchResponseSchema.parse({
        results: [hit],
        degraded: [{ board: 'remoteok', reason: 'timeout' }],
        page: 1,
        pageSize: 10,
      }),
    ).toMatchObject({
      results: [hit],
      degraded: [{ board: 'remoteok', reason: 'timeout' }],
    });
  });

  it('rejects unknown degrade reason', () => {
    expect(
      issuePaths(
        discoverySearchResponseSchema.safeParse({
          results: [],
          degraded: [{ board: 'remoteok', reason: 'oops' }],
          page: 1,
          pageSize: 10,
        }),
      ),
    ).toEqual(['degraded.0.reason']);
  });
});
