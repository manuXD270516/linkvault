import type { CvExtractionStatus } from '@linkvault/shared';

// Puerto hacia `cv` (tarea 8.7). `match` NO lee la colección de CV: el adaptador de producción irá sobre lo que
// exporte `cv` (grupo 11 puede ampliar la fachada). Solo metadatos y estado de lectura; **nunca** el texto.

export const MATCH_CV_READER = Symbol('MATCH_CV_READER');

/** Lo que el caso de uso necesita de un CV propio para decidir si se puede analizar. */
export interface MatchCvSummary {
  readonly id: string;
  readonly extractionStatus: CvExtractionStatus;
  readonly isDefault: boolean;
}

export interface MatchCvReader {
  /** El CV marcado por defecto de esa persona, o `null` si no tiene ninguno. */
  defaultOf(userId: string): Promise<MatchCvSummary | null>;

  /**
   * El CV de esa persona; `null` si no existe, es de otra o el id está mal formado. Un id ajeno se comporta igual que
   * uno inexistente.
   */
  findOwned(cvId: string, userId: string): Promise<MatchCvSummary | null>;
}
