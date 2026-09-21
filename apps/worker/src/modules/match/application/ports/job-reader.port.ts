import type { SkillImportance } from '@linkvault/shared';

// Puerto de lectura de la oferta (tarea 13.2). El worker lee `job_links` directamente; no pasa por la fachada de `api`.

export const JOB_READER = Symbol('JOB_READER');

export interface MatchJobSkill {
  readonly name: string;
  readonly importance: SkillImportance;
}

export interface MatchJobForAnalysis {
  readonly id: string;
  readonly previewVersion: number;
  readonly title: string;
  readonly text: string;
  readonly skills: readonly MatchJobSkill[];
}

export interface JobReader {
  /**
   * Oferta lista para `match-cv`; `null` si no existe, el id está mal formado o no tiene título/texto con los que
   * comparar.
   */
  read(linkId: string): Promise<MatchJobForAnalysis | null>;
}
