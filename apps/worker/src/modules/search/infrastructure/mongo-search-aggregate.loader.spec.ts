import { describe, expect, it } from 'vitest';
import { salaryCurrencyFromPreview } from './mongo-search-aggregate.loader';

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
