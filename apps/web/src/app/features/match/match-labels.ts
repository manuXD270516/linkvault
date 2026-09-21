/**
 * Rótulos y acción de tarjeta del análisis de encaje. Viven fuera del diálogo para que la tarjeta de oferta
 * (tarea 16.16) reutilice el mismo identificador de traducción.
 */

import type { MatchProgressStep } from '@linkvault/shared';

/** Acción de la tarjeta en `/grupos/:id` y `/mis-links`. */
export function matchCardActionLabel(): string {
  return $localize`:@@match.card.action:Analizar mi encaje`;
}

/** Nombre visible de un paso de progreso mientras corre el análisis. */
export function matchProgressStepLabel(step: MatchProgressStep): string {
  switch (step) {
    case 'reading-job':
      return $localize`:@@match.step.readingJob:Leyendo la oferta`;
    case 'comparing-cv':
      return $localize`:@@match.step.comparingCv:Comparando con tu CV`;
    case 'drafting-suggestions':
      return $localize`:@@match.step.draftingSuggestions:Redactando sugerencias`;
    case 'critiquing-suggestions':
      return $localize`:@@match.step.critiquingSuggestions:Revisando sugerencias…`;
    case 'revising-suggestions':
      return $localize`:@@match.step.revisingSuggestions:Mejorando sugerencias…`;
  }
}
