import {
  formatLocalDay,
  formatLocalTime,
  formatRetryAtPhrase,
  retryAtFromMinutes,
  retryAtKind,
} from './match-retry-at';

describe('match-retry-at', () => {
  const now = new Date(2026, 8, 20, 23, 0, 0); // 20 Sep 2026 23:00 local

  it('La hora de vuelta cae en otro día', () => {
    const tomorrow = new Date(2026, 8, 21, 9, 30, 0);
    expect(retryAtKind(tomorrow, now)).toBe('tomorrow');
    expect(formatRetryAtPhrase(tomorrow, now)).toContain('mañana');
    expect(formatRetryAtPhrase(tomorrow, now)).toContain(formatLocalTime(tomorrow));
  });

  it('La espera del 429 cruza la medianoche', () => {
    const minutes = 120; // 23:00 + 2h → 01:00 next day
    const when = retryAtFromMinutes(minutes, now);
    expect(retryAtKind(when, now)).toBe('tomorrow');
    expect(formatRetryAtPhrase(when, now)).toMatch(/mañana a las/);
  });

  it('names a later calendar day', () => {
    const later = new Date(2026, 8, 25, 10, 0, 0);
    expect(retryAtKind(later, now)).toBe('later');
    expect(formatRetryAtPhrase(later, now)).toContain(formatLocalDay(later));
  });

  it('keeps only the time when still today', () => {
    const sameDay = new Date(2026, 8, 20, 23, 45, 0);
    expect(retryAtKind(sameDay, now)).toBe('today');
    expect(formatRetryAtPhrase(sameDay, now)).toBe(`las ${formatLocalTime(sameDay)}`);
  });
});
