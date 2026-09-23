import { describe, expect, it } from 'vitest';
import { APPLICATION_STATUSES } from './application.schema';
import { jobModalitySchema } from './preview.schema';
import { searchQueryParamsSchema } from './search.schema';

function issuePaths(result: {
  error?: { issues: readonly { path: readonly PropertyKey[] }[] };
}): string[] {
  return [
    ...new Set(
      (result.error?.issues ?? []).map((issue) => issue.path.join('.')),
    ),
  ].sort();
}

describe('searchQueryParamsSchema', () => {
  it('accepts q alone and defaults empty q when omitted', () => {
    expect(searchQueryParamsSchema.parse({ q: 'remoto' })).toEqual({
      q: 'remoto',
    });
    expect(searchQueryParamsSchema.parse({})).toEqual({ q: '' });
  });

  it('accepts LatAm filters with valid enums and salaryCurrency', () => {
    expect(
      searchQueryParamsSchema.parse({
        q: 'nest',
        modality: 'remote',
        applicationStatus: 'applied',
        salaryCurrency: 'USD',
      }),
    ).toEqual({
      q: 'nest',
      modality: 'remote',
      applicationStatus: 'applied',
      salaryCurrency: 'USD',
    });
  });

  it('rejects invalid modality naming the field', () => {
    expect(
      issuePaths(
        searchQueryParamsSchema.safeParse({ q: 'x', modality: 'hibrido' }),
      ),
    ).toEqual(['modality']);
    expect(jobModalitySchema.options).toEqual([
      'remote',
      'hybrid',
      'onsite',
      'unknown',
    ]);
  });

  it('rejects invalid applicationStatus naming the field', () => {
    expect(
      issuePaths(
        searchQueryParamsSchema.safeParse({
          q: 'x',
          applicationStatus: 'hired',
        }),
      ),
    ).toEqual(['applicationStatus']);
    expect(APPLICATION_STATUSES).toContain('applied');
  });

  it('rejects empty or whitespace salaryCurrency', () => {
    expect(
      issuePaths(
        searchQueryParamsSchema.safeParse({ q: 'x', salaryCurrency: '' }),
      ),
    ).toEqual(['salaryCurrency']);
    expect(
      issuePaths(
        searchQueryParamsSchema.safeParse({ q: 'x', salaryCurrency: '   ' }),
      ),
    ).toEqual(['salaryCurrency']);
  });

  it('rejects salaryCurrency longer than 16 chars', () => {
    expect(
      issuePaths(
        searchQueryParamsSchema.safeParse({
          q: 'x',
          salaryCurrency: 'ABCDEFGHIJKLMNOPQ',
        }),
      ),
    ).toEqual(['salaryCurrency']);
  });

  it('coerces limit and offset from query strings', () => {
    expect(
      searchQueryParamsSchema.parse({ q: 'a', limit: '20', offset: '5' }),
    ).toEqual({ q: 'a', limit: 20, offset: 5 });
  });
});
