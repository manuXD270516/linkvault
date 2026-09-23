/**
 * Semana ISO UTC (W−1 cerrada) para el digest de grupo.
 * weekKey = `YYYY-Www`; ventana = [start(W−1), start(W)).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Lunes 00:00 UTC de la semana ISO que contiene `date`. */
export function startOfIsoWeekUtc(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0=domingo
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** weekKey ISO `YYYY-Www` de la semana que contiene `date` (UTC). */
export function isoWeekKey(date: Date): string {
  // El jueves de la semana determina el año ISO.
  const monday = startOfIsoWeekUtc(date);
  const thursday = new Date(monday.getTime() + 3 * MS_PER_DAY);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Monday = startOfIsoWeekUtc(jan4);
  const week =
    Math.floor((monday.getTime() - week1Monday.getTime()) / (7 * MS_PER_DAY)) +
    1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

export interface ClosedIsoWeekWindow {
  readonly weekKey: string;
  /** Inclusivo: start(W−1). */
  readonly start: Date;
  /** Exclusivo: start(W). */
  readonly end: Date;
}

/**
 * Semana ISO recién cerrada respecto a `now` (típicamente el lunes que abre W).
 * Ventana `[start(W−1), start(W))`.
 */
export function previousClosedIsoWeek(now: Date): ClosedIsoWeekWindow {
  const thisWeekStart = startOfIsoWeekUtc(now);
  const start = new Date(thisWeekStart.getTime() - 7 * MS_PER_DAY);
  return {
    weekKey: isoWeekKey(start),
    start,
    end: thisWeekStart,
  };
}

/** Inicio UTC del lunes de un weekKey `YYYY-Www`. */
export function startOfWeekKeyUtc(weekKey: string): Date {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (match === null) {
    throw new Error(`Invalid weekKey "${weekKey}"`);
  }
  const isoYear = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1Monday = startOfIsoWeekUtc(jan4);
  return new Date(week1Monday.getTime() + (week - 1) * 7 * MS_PER_DAY);
}

/** Ventana cerrada `[start(weekKey), start(weekKey)+7d)` para un weekKey dado. */
export function windowForWeekKey(weekKey: string): {
  readonly start: Date;
  readonly end: Date;
} {
  const start = startOfWeekKeyUtc(weekKey);
  const end = new Date(start.getTime() + 7 * MS_PER_DAY);
  return { start, end };
}
