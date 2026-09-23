import { describe, expect, it } from 'vitest';
import {
  isoWeekKey,
  previousClosedIsoWeek,
  startOfIsoWeekUtc,
  windowForWeekKey,
} from './iso-week';

describe('iso-week', () => {
  it('startOfIsoWeekUtc es lunes 00:00 UTC', () => {
    // Miércoles 2026-09-23 → lunes 2026-09-21
    const start = startOfIsoWeekUtc(new Date('2026-09-23T15:30:00.000Z'));
    expect(start.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  it('previousClosedIsoWeek en lunes de W = ventana W−1', () => {
    // Lunes 2026-09-21 abre la semana ISO 2026-W39 → W−1 = 2026-W38
    const closed = previousClosedIsoWeek(
      new Date('2026-09-21T14:00:00.000Z'),
    );
    expect(closed.weekKey).toBe('2026-W38');
    expect(closed.start.toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(closed.end.toISOString()).toBe('2026-09-21T00:00:00.000Z');
    expect(isoWeekKey(closed.start)).toBe('2026-W38');
  });

  it('windowForWeekKey coincide con previousClosed', () => {
    const w = windowForWeekKey('2026-W38');
    expect(w.start.toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });
});
