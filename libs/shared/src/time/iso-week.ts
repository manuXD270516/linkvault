import { z } from 'zod';

// Semana ISO en UTC, una sola vez para el worker y la api (change group-weekly-brief, D10).
// weekKey = `YYYY-Www`; ventana = [lunes 00:00Z, lunes siguiente 00:00Z).
// Para Bolivia (UTC−4) la semana cambia el domingo a las 20:00: se acepta.

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** weekKey ISO `YYYY-Www` con semana 01 a 53. */
export const isoWeekKeySchema = z
  .string()
  .regex(/^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/);
export type IsoWeekKey = z.infer<typeof isoWeekKeySchema>;

/** Lunes 00:00 UTC de la semana ISO que contiene `date`. */
export function startOfIsoWeekUtc(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0 = domingo
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** `YYYY-Www` de la semana ISO que contiene `date` (UTC). */
export function isoWeekKey(date: Date): string {
  const monday = startOfIsoWeekUtc(date);
  // El jueves de la semana determina el año ISO.
  const thursday = new Date(monday.getTime() + 3 * MS_PER_DAY);
  const isoYear = thursday.getUTCFullYear();
  const week1Monday = startOfIsoWeekUtc(new Date(Date.UTC(isoYear, 0, 4)));
  const week =
    Math.floor((monday.getTime() - week1Monday.getTime()) / MS_PER_WEEK) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Lunes 00:00 UTC de un `weekKey`; lanza si el formato no es `YYYY-Www`. */
export function startOfWeekKeyUtc(weekKey: string): Date {
  if (!isoWeekKeySchema.safeParse(weekKey).success) {
    throw new Error(`Invalid weekKey "${weekKey}"`);
  }
  const isoYear = Number(weekKey.slice(0, 4));
  const week = Number(weekKey.slice(6));
  const week1Monday = startOfIsoWeekUtc(new Date(Date.UTC(isoYear, 0, 4)));
  return new Date(week1Monday.getTime() + (week - 1) * MS_PER_WEEK);
}

/** Semana ISO anterior a `weekKey`. */
export function previousWeekKey(weekKey: string): string {
  return isoWeekKey(
    new Date(startOfWeekKeyUtc(weekKey).getTime() - MS_PER_WEEK),
  );
}

/** Semana ISO siguiente a `weekKey`. */
export function nextWeekKey(weekKey: string): string {
  return isoWeekKey(
    new Date(startOfWeekKeyUtc(weekKey).getTime() + MS_PER_WEEK),
  );
}

/** Ventana cerrada `[start(weekKey), start(weekKey)+7d)` para un weekKey dado. */
export function windowForWeekKey(weekKey: string): {
  readonly start: Date;
  readonly end: Date;
} {
  const start = startOfWeekKeyUtc(weekKey);
  return { start, end: new Date(start.getTime() + MS_PER_WEEK) };
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
  const start = new Date(thisWeekStart.getTime() - MS_PER_WEEK);
  return { weekKey: isoWeekKey(start), start, end: thisWeekStart };
}
