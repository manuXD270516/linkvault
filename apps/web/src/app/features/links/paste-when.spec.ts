import { whenText } from './paste-when';

/** Reloj falso solo para `Date`, con la hora local fijada: `whenText` recibe `now`, pero el ejemplo es el del diálogo. */
function at(
  hours: number,
  minutes: number,
  seconds: number,
  ms: number,
  day = 30,
): Date {
  return new Date(2026, 9, day, hours, minutes, seconds, ms);
}

describe('whenText', () => {
  it('today and tomorrow', () => {
    expect(whenText(at(10, 0, 0, 0), 180, 'es')).toBe('hoy a las 13:00');
    expect(whenText(at(22, 0, 0, 0), 180, 'es')).toBe('mañana a las 01:00');
  });

  it('an exact minute is not rounded', () => {
    expect(whenText(at(10, 0, 0, 0), 180, 'es')).toBe('hoy a las 13:00');
  });

  it('rounds up to the next minute', () => {
    expect(whenText(at(10, 0, 30, 0), 180, 'es')).toBe('hoy a las 13:01');
  });

  it('milliseconds alone round up', () => {
    expect(whenText(at(10, 0, 0, 1), 180, 'es')).toBe('hoy a las 13:01');
  });

  it('past tomorrow gives no time', () => {
    expect(whenText(at(23, 59, 30, 0), 1440, 'es')).toBeNull();
  });

  it('no Retry-After gives no time', () => {
    expect(whenText(at(10, 0, 0, 0), null, 'es')).toBeNull();
  });
});
