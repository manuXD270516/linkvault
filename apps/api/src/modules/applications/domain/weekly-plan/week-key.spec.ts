import { describe, expect, it } from 'vitest';
import { isoWeekKey, nextWeekKey, previousWeekKey } from './week-key';

describe('week-key', () => {
  it('2026-12-31T23:30Z is 2026-W53', () => {
    expect(isoWeekKey(new Date('2026-12-31T23:30:00Z'))).toBe('2026-W53');
  });

  it('2027-01-03 is 2026-W53', () => {
    expect(isoWeekKey(new Date('2027-01-03T12:00:00Z'))).toBe('2026-W53');
  });

  it('2027-01-04 is 2027-W01', () => {
    expect(isoWeekKey(new Date('2027-01-04T00:00:00Z'))).toBe('2027-W01');
  });

  it('previous of 2027-W01 is 2026-W53', () => {
    expect(previousWeekKey('2027-W01')).toBe('2026-W53');
  });

  it('next of 2026-W53 is 2027-W01', () => {
    expect(nextWeekKey('2026-W53')).toBe('2027-W01');
  });

  it('Monday 00:00Z starts a new week', () => {
    expect(isoWeekKey(new Date('2026-11-22T23:59:59Z'))).toBe('2026-W47');
    expect(isoWeekKey(new Date('2026-11-23T00:00:00Z'))).toBe('2026-W48');
  });
});
