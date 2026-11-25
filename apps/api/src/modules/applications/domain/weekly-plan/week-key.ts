// Semana ISO en UTC (D6 de weekly-plan). Copia de `apps/worker/src/modules/notifications/domain/iso-week.ts` (`isoWeekKey`,
// `startOfIsoWeekUtc`, `startOfWeekKeyUtc`) con los mismos vectores de test; se unifica en una lib compartida en el corte
// `weekly-plan-monday` (R5). Para Bolivia (UTC−4) la semana cambia el domingo a las 20:00: se acepta.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Lunes 00:00 UTC de la semana ISO que contiene `date`. */
function startOfIsoWeekUtc(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0 = domingo
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
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
    Math.floor((monday.getTime() - week1Monday.getTime()) / (7 * MS_PER_DAY)) +
    1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Lunes 00:00 UTC de un `weekKey`; lanza si el formato no es `YYYY-Www`. */
function startOfWeekKeyUtc(weekKey: string): Date {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (match === null) {
    throw new Error(`Invalid weekKey "${weekKey}"`);
  }
  const week1Monday = startOfIsoWeekUtc(
    new Date(Date.UTC(Number(match[1]), 0, 4)),
  );
  return new Date(
    week1Monday.getTime() + (Number(match[2]) - 1) * 7 * MS_PER_DAY,
  );
}

/** Semana ISO anterior a `weekKey`. */
export function previousWeekKey(weekKey: string): string {
  return isoWeekKey(
    new Date(startOfWeekKeyUtc(weekKey).getTime() - 7 * MS_PER_DAY),
  );
}

/** Semana ISO siguiente a `weekKey`. */
export function nextWeekKey(weekKey: string): string {
  return isoWeekKey(
    new Date(startOfWeekKeyUtc(weekKey).getTime() + 7 * MS_PER_DAY),
  );
}
