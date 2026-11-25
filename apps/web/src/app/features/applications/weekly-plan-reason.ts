import type { WeeklyPlanReason } from '@linkvault/shared';

/**
 * Motivo de una acción del plan semanal (design D10). El texto no viaja por la API: se arma aquí desde `reason`, con
 * un mensaje `$localize` por variante (singular y plural se eligen en código, C9), así cada frase tiene su id en el
 * catálogo y se prueba sin renderizar.
 */
export function weeklyPlanReasonText(reason: WeeklyPlanReason): string {
  switch (reason.kind) {
    case 'closing_soon':
      return closingSoonText(reason.daysLeft);
    case 'high_fit':
      return $localize`:@@applications.weeklyPlan.reason.highFit:Encaja ${reason.score}:SCORE:/100 según tu análisis: postula.`;
    case 'quiet':
      return $localize`:@@applications.weeklyPlan.reason.quiet:${reason.daysQuiet}:DAYS: días sin novedades: manda un seguimiento.`;
    case 'know_someone':
      return reason.count === 1
        ? $localize`:@@applications.weeklyPlan.reason.knowSomeoneOne:1 persona de tu grupo conoce a alguien ahí: pregunta en el grupo.`
        : $localize`:@@applications.weeklyPlan.reason.knowSomeoneMany:${reason.count}:COUNT: personas de tu grupo conocen a alguien ahí: pregunta en el grupo.`;
  }
}

function closingSoonText(daysLeft: number): string {
  if (daysLeft === 0) {
    return $localize`:@@applications.weeklyPlan.reason.closesToday:Cierra hoy: postula hoy.`;
  }
  return daysLeft === 1
    ? $localize`:@@applications.weeklyPlan.reason.closesInOneDay:Cierra en 1 día: postula antes.`
    : $localize`:@@applications.weeklyPlan.reason.closesInDays:Cierra en ${daysLeft}:DAYS: días: postula antes.`;
}
