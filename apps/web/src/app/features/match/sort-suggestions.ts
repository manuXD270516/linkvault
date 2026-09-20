import type { MatchSuggestion, SkillImportance } from '@linkvault/shared';

/** Cuántas sugerencias se muestran de entrada (spec web/cv-match); el resto van tras el gesto. */
export const MATCH_SUGGESTIONS_PAGE_SIZE = 5;

const IMPORTANCE_ORDER: Record<SkillImportance, number> = { must: 0, nice: 1 };

/**
 * Ordena por la `importance` de la evidencia de cada sugerencia —primero imprescindibles—, sin adivinar
 * correspondencias con `missingSkills`. Estable dentro del mismo peso.
 */
export function sortSuggestionsByEvidence(
  suggestions: readonly MatchSuggestion[],
): MatchSuggestion[] {
  return [...suggestions]
    .filter((suggestion) => suggestion.evidence.jobRequirement.trim() !== '')
    .sort(
      (a, b) =>
        IMPORTANCE_ORDER[a.evidence.importance] - IMPORTANCE_ORDER[b.evidence.importance],
    );
}
