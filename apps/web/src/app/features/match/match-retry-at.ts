/**
 * Formatea el momento de vuelta de un límite (cuota diaria de IA o `429` de la API) con el día cuando no es hoy
 * (spec web/cv-match, tarea 15.18). La ventana es configurable y cruza la medianoche con normalidad.
 */

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Hora local `HH:mm`. */
export function formatLocalTime(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Fecha local `dd/MM/yyyy`. */
export function formatLocalDay(date: Date): string {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export type RetryAtKind = 'today' | 'tomorrow' | 'later';

/** Clasifica `when` respecto a `now` en el calendario local. */
export function retryAtKind(when: Date, now: Date = new Date()): RetryAtKind {
  const days = Math.round((startOfLocalDay(when) - startOfLocalDay(now)) / 86_400_000);
  if (days <= 0) {
    return 'today';
  }
  if (days === 1) {
    return 'tomorrow';
  }
  return 'later';
}

/**
 * Fragmento tras "a partir de …" listo para interpolar en los mensajes de cuota / 429.
 * Hoy → "las 14:00"; mañana → "mañana a las 14:00"; más allá → "el 22/09/2026 a las 14:00".
 */
export function formatRetryAtPhrase(isoOrDate: string | Date, now: Date = new Date()): string {
  const when = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  const time = formatLocalTime(when);
  switch (retryAtKind(when, now)) {
    case 'today':
      return $localize`:@@match.retryAt.today:las ${time}:TIME:`;
    case 'tomorrow':
      return $localize`:@@match.retryAt.tomorrow:mañana a las ${time}:TIME:`;
    case 'later': {
      const day = formatLocalDay(when);
      return $localize`:@@match.retryAt.later:el ${day}:DATE: a las ${time}:TIME:`;
    }
  }
}

/** Instantáneo de vuelta a partir de `Retry-After` en minutos (como lo deja `toRequestFailure`). */
export function retryAtFromMinutes(
  minutes: number,
  now: Date = new Date(),
): Date {
  return new Date(now.getTime() + minutes * 60_000);
}
