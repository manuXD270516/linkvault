import type { JobLinkSummary } from '@linkvault/shared';
import { isStillReading } from './link-status';

/**
 * Qué avisa «Copiar enlace» de una oferta publicada (design D6 de usage-guide-fixes):
 * - `reading`: la tarjeta aún dice «Leyendo la oferta…»;
 * - `notAJob`: la lectura terminó en «Esto no parece una oferta»; no hay nada que completar;
 * - `empty`: sin puesto por cualquier otro motivo (lectura fallida o parcial, edición a mano sin puesto, lectura
 *   pendiente que ya no se espera).
 */
export type EmptyCardNotice = 'reading' | 'empty' | 'notAJob';

/**
 * El aviso depende **solo** de que la tarjeta no tenga puesto (`preview.title`), no del nombre del estado. Con puesto
 * —leído, pegado o escrito a mano— no hay aviso. `now` es la hora de cada evaluación, como en `linkCardStatus`.
 */
export function emptyCardNotice(
  link: JobLinkSummary,
  now: Date,
): EmptyCardNotice | null {
  const title = link.preview?.title;
  if (typeof title === 'string' && title.trim().length > 0) {
    return null;
  }
  if (isStillReading(link, now)) {
    return 'reading';
  }
  return link.lastEnrichmentError?.reason === 'not_a_job' ? 'notAJob' : 'empty';
}

/** Texto de cada aviso, el mismo en el formulario de guardar y en la tarjeta. Sin punto final. */
export function emptyCardNoticeText(notice: EmptyCardNotice): string {
  switch (notice) {
    case 'reading':
      return $localize`:@@links.public.copyUnread:Todavía estamos leyendo la oferta: si lo envías ahora, la tarjeta saldrá sin datos`;
    case 'notAJob':
      return $localize`:@@links.public.copyNotAJob:Esto no parece una oferta: si lo envías, la tarjeta saldrá sin datos`;
    case 'empty':
      return $localize`:@@links.public.copyFailedEmpty:La tarjeta todavía no tiene el puesto: si lo envías ahora, saldrá sin datos. Complétala antes desde la tarjeta`;
  }
}
