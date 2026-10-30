import { describe, expect, it } from 'vitest';
import { aggregateProviderCondition } from './provider-condition';

describe('aggregateProviderCondition', () => {
  it('unavailable wins over rate_limited and rejected', () => {
    expect(
      aggregateProviderCondition('providers_failed', [
        'rejected',
        'rate_limited',
        'unavailable',
      ]),
    ).toEqual({ kind: 'unavailable' });
  });

  it('rate_limited wins over rejected', () => {
    expect(
      aggregateProviderCondition('no_providers', ['rejected', 'rate_limited']),
    ).toEqual({ kind: 'rate_limited' });
  });

  it('rejected stands alone', () => {
    expect(
      aggregateProviderCondition('providers_failed', ['rejected']),
    ).toEqual({ kind: 'rejected' });
  });

  it('consent_missing wins with no_providers', () => {
    expect(
      aggregateProviderCondition('no_providers', [
        'unavailable',
        'consent_missing',
      ]),
    ).toEqual({ kind: 'consent_missing' });
  });

  it('consent_missing does not count with providers_failed', () => {
    expect(
      aggregateProviderCondition('providers_failed', [
        'consent_missing',
        'rate_limited',
      ]),
    ).toEqual({ kind: 'rate_limited' });
    expect(
      aggregateProviderCondition('providers_failed', ['consent_missing']),
    ).toBeUndefined();
  });

  it('no affected providers give no condition', () => {
    expect(aggregateProviderCondition('no_providers', [])).toBeUndefined();
    expect(aggregateProviderCondition('providers_failed', [])).toBeUndefined();
  });

  it('quota_exceeded and consent_required never carry a condition', () => {
    expect(
      aggregateProviderCondition('quota_exceeded', ['unavailable']),
    ).toBeUndefined();
    expect(
      aggregateProviderCondition('consent_required', ['consent_missing']),
    ).toBeUndefined();
  });
});
