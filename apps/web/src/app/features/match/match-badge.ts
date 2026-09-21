/** Umbrales del badge de encaje (spec web/cv-match; Q2 del design). */
export const MATCH_SCORE_HIGH = 75;
export const MATCH_SCORE_MID = 50;

export type MatchBadgeLevel = 'high' | 'mid' | 'low';

/** Tramo de la escala para un informe completo. */
export function matchBadgeLevel(score: number): MatchBadgeLevel {
  if (score >= MATCH_SCORE_HIGH) {
    return 'high';
  }
  if (score >= MATCH_SCORE_MID) {
    return 'mid';
  }
  return 'low';
}

/** Etiqueta del tramo; nombra el encaje, no a la persona. */
export function matchBadgeLabel(level: MatchBadgeLevel): string {
  switch (level) {
    case 'high':
      return $localize`:@@match.badge.high:Encaje alto`;
    case 'mid':
      return $localize`:@@match.badge.mid:Encaje medio`;
    case 'low':
      return $localize`:@@match.badge.low:Encaje bajo`;
  }
}

/** Etiqueta del análisis básico: sin número. */
export function matchBadgeDegradedLabel(): string {
  return $localize`:@@match.badge.degraded:Encaje aproximado — comparamos listas de habilidades`;
}

/** Línea fija bajo el badge que explica la escala. */
export function matchBadgeExplainer(): string {
  return $localize`:@@match.badge.explainer:Cuánto de lo que pide esta oferta ya aparece en tu CV.`;
}
