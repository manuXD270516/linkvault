import { describe, expect, it } from 'vitest';
import {
  closedAtFromLink,
  salaryBoundsFromPreview,
  salaryCurrencyFromPreview,
} from './mongo-search-aggregate.loader';

describe('salaryCurrencyFromPreview', () => {
  it('copies a non-empty currency string', () => {
    expect(salaryCurrencyFromPreview({ currency: 'USD' })).toBe('USD');
    expect(salaryCurrencyFromPreview({ currency: 'BOB' })).toBe('BOB');
  });

  it('omits when salary is absent or currency null/empty', () => {
    expect(salaryCurrencyFromPreview(undefined)).toBeUndefined();
    expect(salaryCurrencyFromPreview(null)).toBeUndefined();
    expect(salaryCurrencyFromPreview({})).toBeUndefined();
    expect(salaryCurrencyFromPreview({ currency: null })).toBeUndefined();
    expect(salaryCurrencyFromPreview({ currency: '' })).toBeUndefined();
    expect(salaryCurrencyFromPreview({ currency: '   ' })).toBeUndefined();
  });
});

describe('salaryBoundsFromPreview', () => {
  it('maps both numeric extremes', () => {
    expect(salaryBoundsFromPreview({ min: 3000, max: 5000 })).toEqual({
      salaryMin: 3000,
      salaryMax: 5000,
    });
  });

  it('keeps only min and nulls max when max absent', () => {
    expect(salaryBoundsFromPreview({ min: 4000, max: null })).toEqual({
      salaryMin: 4000,
      salaryMax: null,
    });
  });

  it('keeps only max and nulls min when min absent', () => {
    expect(salaryBoundsFromPreview({ min: null, max: 7000 })).toEqual({
      salaryMin: null,
      salaryMax: 7000,
    });
  });

  it('nulls both when salary absent (Meili merge clear)', () => {
    expect(salaryBoundsFromPreview(undefined)).toEqual({
      salaryMin: null,
      salaryMax: null,
    });
    expect(salaryBoundsFromPreview(null)).toEqual({
      salaryMin: null,
      salaryMax: null,
    });
    expect(salaryBoundsFromPreview({})).toEqual({
      salaryMin: null,
      salaryMax: null,
    });
  });
});

describe('closedAtFromLink', () => {
  it('writes ISO when closed and null when open (ADR-041)', () => {
    expect(
      closedAtFromLink({ closedAt: new Date('2026-09-22T18:00:00.000Z') }),
    ).toBe('2026-09-22T18:00:00.000Z');
    expect(closedAtFromLink({ closedAt: '2026-09-22T18:00:00.000Z' })).toBe(
      '2026-09-22T18:00:00.000Z',
    );
    expect(closedAtFromLink({})).toBeNull();
    expect(closedAtFromLink({ closedAt: undefined })).toBeNull();
  });
});
