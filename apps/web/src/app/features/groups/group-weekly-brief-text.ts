import type { GroupBriefFactView } from '@linkvault/shared';

/**
 * Textos de «La semana del grupo» (design D9, spec web/group-weekly-brief). El texto no viaja por la API: se arma aquí
 * desde el hecho citado, con un mensaje `$localize` por variante (singular y plural se eligen en código, como
 * `weeklyPlanReasonText`), así cada frase tiene su id `@@groups.weeklyBrief.*` en el catálogo y se prueba sin renderizar.
 */

/**
 * Fecha sin hora (`YYYY-MM-DD`) en UTC, con día de la semana, día y mes en el idioma de la interfaz
 * («lunes, 23 de noviembre» / «Monday, November 23»). UTC para que la fecha no cambie de día según la zona del navegador.
 */
export function formatUtcDate(date: string, locale: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(parsed);
}

/** Texto de una viñeta a partir de su hecho. Los números son exactamente los del hecho. */
export function groupBriefBulletText(fact: GroupBriefFactView, locale: string): string {
  switch (fact.kind) {
    case 'closing_soon': {
      const firstExpiresAt = formatUtcDate(fact.firstExpiresAt, locale);
      return fact.count === 1
        ? $localize`:@@groups.weeklyBrief.bullet.closingOne:1 oferta cierra el ${firstExpiresAt}:DATE:.`
        : $localize`:@@groups.weeklyBrief.bullet.closingMany:${fact.count}:COUNT: ofertas cierran en los próximos días; la primera, el ${firstExpiresAt}:DATE:.`;
    }
    case 'skill_demand': {
      const skillLabel = fact.skillLabel;
      return $localize`:@@groups.weeklyBrief.bullet.skill:${skillLabel}:SKILL: aparece en ${fact.count}:COUNT: de las ${fact.total}:TOTAL: ofertas abiertas con habilidades detectadas.`;
    }
    case 'shared_last_week':
      return fact.count === 1
        ? $localize`:@@groups.weeklyBrief.bullet.sharedOne:Se compartió 1 oferta en el grupo la semana pasada.`
        : $localize`:@@groups.weeklyBrief.bullet.sharedMany:Se compartieron ${fact.count}:COUNT: ofertas en el grupo la semana pasada.`;
  }
}

/** «Actualizada el {fecha} · N ofertas abiertas» (singular «1 oferta abierta»). */
export function groupBriefHeaderText(asOf: string, openOffers: number, locale: string): string {
  const date = formatUtcDate(asOf, locale);
  return openOffers === 1
    ? $localize`:@@groups.weeklyBrief.header.one:Actualizada el ${date}:DATE: · 1 oferta abierta`
    : $localize`:@@groups.weeklyBrief.header.many:Actualizada el ${date}:DATE: · ${openOffers}:COUNT: ofertas abiertas`;
}

/** «cierra el {fecha}» junto a cada oferta de una viñeta `closing_soon`. */
export function groupBriefOfferClosesText(expiresAt: string, locale: string): string {
  const date = formatUtcDate(expiresAt, locale);
  return $localize`:@@groups.weeklyBrief.offer.closes:cierra el ${date}:DATE:`;
}

/** Texto del botón cerrado: «Ver ofertas (N)». */
export function groupBriefShowOffersText(count: number): string {
  return $localize`:@@groups.weeklyBrief.showOffers:Ver ofertas (${count}:COUNT:)`;
}

/** «y N más en el listado del grupo» (singular «y 1 más …»). */
export function groupBriefMoreText(moreCount: number): string {
  return moreCount === 1
    ? $localize`:@@groups.weeklyBrief.moreOne:y 1 más en el listado del grupo`
    : $localize`:@@groups.weeklyBrief.moreMany:y ${moreCount}:COUNT: más en el listado del grupo`;
}

/** «N ya no están en el grupo» (singular «1 ya no está en el grupo»). */
export function groupBriefMissingText(missingCount: number): string {
  return missingCount === 1
    ? $localize`:@@groups.weeklyBrief.missingOne:1 ya no está en el grupo`
    : $localize`:@@groups.weeklyBrief.missingMany:${missingCount}:COUNT: ya no están en el grupo`;
}
