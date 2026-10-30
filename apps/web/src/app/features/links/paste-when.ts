/**
 * Cuándo se podrá volver a pegar tras `ai_quota_exceeded` (spec web/links, «Pegar la descripción»).
 *
 * `retryAfterMinutes` ya viene redondeado hacia arriba a minutos desde `Retry-After`. Aquí se suma al instante actual y,
 * si el resultado no cae en un minuto exacto (segundos o milisegundos distintos de cero), se redondea hacia arriba al
 * minuto siguiente: nunca se anuncia una hora anterior a la real. Se dice en la hora local del navegador: «hoy a las
 * HH:mm» o «mañana a las HH:mm».
 *
 * La ventana de la cuota de IA es fija de 24 h, así que no hay rama de fecha. Si el instante redondeado cae más allá de
 * mañana (el redondeo cruza la medianoche, o la noche de un cambio de hora) o no hay `Retry-After`, devuelve `null` y
 * quien llama usa el texto sin hora.
 */
export function whenText(
  now: Date,
  retryAfterMinutes: number | null,
  locale: string,
): string | null {
  if (retryAfterMinutes === null) {
    return null;
  }
  let target = now.getTime() + retryAfterMinutes * 60_000;
  if (target % 60_000 !== 0) {
    target = Math.floor(target / 60_000) * 60_000 + 60_000;
  }
  const at = new Date(target);
  const days = calendarDaysBetween(now, at);
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
  if (days === 0) {
    return $localize`:@@links.paste.when.today:hoy a las ${time}:time:`;
  }
  if (days === 1) {
    return $localize`:@@links.paste.when.tomorrow:mañana a las ${time}:time:`;
  }
  return null;
}

/** Días de calendario local entre dos instantes (no múltiplos de 24 h: un cambio de hora dura 23 o 25). */
function calendarDaysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / 86_400_000);
}
