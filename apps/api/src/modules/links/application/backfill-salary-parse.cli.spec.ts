import { describe, expect, it } from 'vitest';
import { parseBackfillSalaryParseArgs } from './backfill-salary-parse.cli';

describe('parseBackfillSalaryParseArgs', () => {
  it('defaults limit and dryRun', () => {
    expect(parseBackfillSalaryParseArgs([])).toEqual({
      limit: 500,
      dryRun: false,
    });
  });

  it('parses --limit and --dry-run', () => {
    expect(
      parseBackfillSalaryParseArgs(['--limit=100', '--dry-run']),
    ).toEqual({ limit: 100, dryRun: true });
  });

  it('rejects unknown args', () => {
    expect(() => parseBackfillSalaryParseArgs(['--docType=job_preview'])).toThrow(
      RangeError,
    );
  });

  it('rejects invalid limit', () => {
    expect(() => parseBackfillSalaryParseArgs(['--limit=0'])).toThrow(
      RangeError,
    );
  });
});
