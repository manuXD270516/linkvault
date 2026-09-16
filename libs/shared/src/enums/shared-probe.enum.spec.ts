import { describe, expect, it } from 'vitest';
import { SharedProbe } from './shared-probe.enum';

describe('SharedProbe', () => {
  it('exposes a single string member', () => {
    expect(Object.values(SharedProbe)).toEqual(['resolved']);
    expect(SharedProbe.Resolved).toBe('resolved');
  });
});
