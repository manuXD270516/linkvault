import { describe, expect, it } from 'vitest';
import { parseBackfillSearchArgs } from './backfill-search.cli';

describe('parseBackfillSearchArgs', () => {
  it('defaults limit and optional flags', () => {
    expect(parseBackfillSearchArgs([])).toEqual({
      limit: 500,
      dryRun: false,
      reembed: false,
      docType: undefined,
      userId: undefined,
    });
  });

  it('parses docType and limit', () => {
    expect(
      parseBackfillSearchArgs(['--docType=job_preview', '--limit=100']),
    ).toMatchObject({ docType: 'job_preview', limit: 100 });
  });

  it('rejects unknown args', () => {
    expect(() => parseBackfillSearchArgs(['--status=pending'])).toThrow(
      RangeError,
    );
  });

  it('rejects invalid docType', () => {
    expect(() => parseBackfillSearchArgs(['--docType=nope'])).toThrow(
      RangeError,
    );
  });
});
