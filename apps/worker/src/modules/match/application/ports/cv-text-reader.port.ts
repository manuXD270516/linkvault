// Puerto de lectura del texto del CV (tarea 13.2). El worker sí lee el texto: es quien ejecuta `match-cv`.

export const CV_TEXT_READER = Symbol('CV_TEXT_READER');

export type CvTextRead =
  | { readonly kind: 'ready'; readonly text: string }
  /** El CV existe pero su extracción no dejó texto usable. */
  | { readonly kind: 'unreadable' }
  /** El CV no existe (borrado) o no es de esa persona. */
  | { readonly kind: 'missing' };

export interface CvTextReader {
  /**
   * Texto extraído del CV de esa persona. `missing` si no existe o es ajeno; `unreadable` si existe pero no hay
   * texto extraído listo.
   */
  read(cvId: string, userId: string): Promise<CvTextRead>;
}
