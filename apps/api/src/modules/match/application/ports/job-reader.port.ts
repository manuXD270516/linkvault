// Puerto hacia `links` (tarea 8.7). `match` NO lee las colecciones de links: el adaptador de producción irá sobre
// `LinksFacade` (ampliado en el grupo 9 si hace falta). Solo tipos y el token.

export const MATCH_JOB_READER = Symbol('MATCH_JOB_READER');

/**
 * Lo que el caso de uso necesita de una oferta visible: su `previewVersion` y si hay título o texto con los que
 * comparar. Sin título **y** sin texto → `JobNotReady`.
 */
export interface MatchJobSummary {
  readonly id: string;
  readonly previewVersion: number;
  readonly title?: string;
  /** Descripción / texto de la vacante ya leído o pegado. */
  readonly description?: string;
}

export interface MatchJobReader {
  /**
   * `true` si la persona ve la oferta (lista privada o grupo suyo). Un id mal formado responde `false`, igual que uno
   * inexistente o ajeno.
   */
  canRead(userId: string, linkId: string): Promise<boolean>;

  /**
   * Ficha de la oferta para el análisis; `null` si no existe o el id está mal formado. Quien llama comprueba antes
   * `canRead`: este método no aplica el permiso.
   */
  summaryOf(linkId: string): Promise<MatchJobSummary | null>;
}
