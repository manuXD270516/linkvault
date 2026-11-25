import { describe, expect, it } from 'vitest';
import {
  isoWeekKey,
  isoWeekKeySchema,
  nextWeekKey,
  previousClosedIsoWeek,
  previousWeekKey,
  startOfIsoWeekUtc,
  startOfWeekKeyUtc,
  windowForWeekKey,
} from './iso-week';

describe('iso-week', () => {
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

  it('startOfIsoWeekUtc is Monday 00:00 UTC', () => {
    const start = startOfIsoWeekUtc(new Date('2026-09-23T15:30:00.000Z'));
    expect(start.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  it('previousClosedIsoWeek on the Monday of W is the window of W-1', () => {
    const closed = previousClosedIsoWeek(new Date('2026-09-21T14:00:00.000Z'));
    expect(closed.weekKey).toBe('2026-W38');
    expect(closed.start.toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(closed.end.toISOString()).toBe('2026-09-21T00:00:00.000Z');
    expect(isoWeekKey(closed.start)).toBe('2026-W38');
  });

  it('window of 2026-W38 is Sep 14 to Sep 21', () => {
    const w = windowForWeekKey('2026-W38');
    expect(w.start.toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  it('window of 2026-W48 is Nov 23 to Nov 30', () => {
    const w = windowForWeekKey('2026-W48');
    expect(w.start.toISOString()).toBe('2026-11-23T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-11-30T00:00:00.000Z');
  });

  it('startOfWeekKeyUtc throws on a malformed key', () => {
    expect(() => startOfWeekKeyUtc('2026-48')).toThrow('Invalid weekKey');
  });

  it('isoWeekKeySchema accepts 2026-W48 and 2026-W53', () => {
    expect(isoWeekKeySchema.safeParse('2026-W48').success).toBe(true);
    expect(isoWeekKeySchema.safeParse('2026-W53').success).toBe(true);
  });

  it('isoWeekKeySchema rejects 2026-48', () => {
    expect(isoWeekKeySchema.safeParse('2026-48').success).toBe(false);
  });

  it('isoWeekKeySchema rejects week 00 and week 54', () => {
    expect(isoWeekKeySchema.safeParse('2026-W00').success).toBe(false);
    expect(isoWeekKeySchema.safeParse('2026-W54').success).toBe(false);
  });
});
