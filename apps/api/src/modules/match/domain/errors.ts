// Errores de dominio del módulo `match` (specs `cv/match`). Cada uno lleva el código de la API que le corresponde; el
// filtro de errores de presentación decide el estado HTTP.
//
// **Ninguno lleva texto del CV, de la oferta, del prompt ni credenciales**: un error acaba en un log más a menudo de lo
// que parece, y lo que no se escribe no se puede filtrar.

/** Códigos de `apiErrorCodeSchema` que produce el dominio de `match` (lo comprueba un test). */
export type MatchErrorCode =
  | 'analysis_not_found'
  | 'no_cv'
  | 'cv_not_ready'
  | 'cv_not_readable'
  | 'job_not_ready'
  | 'too_many_attempts';

export abstract class MatchError extends Error {
  abstract readonly code: MatchErrorCode;
}

/**
 * No hay ningún análisis resuelto ni en curso de esa persona sobre esa oferta (404). Distinto de `link_not_found`: la
 * oferta puede verse y aun así no haber pedido el análisis.
 */
export class AnalysisNotFound extends MatchError {
  override readonly name = 'AnalysisNotFound';
  readonly code = 'analysis_not_found';

  constructor() {
    super('Analysis not found');
  }
}

/** Todavía no hay ningún CV guardado (409). Sin CV no hay con qué comparar. */
export class NoCv extends MatchError {
  override readonly name = 'NoCv';
  readonly code = 'no_cv';

  constructor() {
    super('Upload a CV before analysing a job');
  }
}

/** El CV elegido todavía se está leyendo (409). Pedir el análisis ahora no encola nada. */
export class CvNotReady extends MatchError {
  override readonly name = 'CvNotReady';
  readonly code = 'cv_not_ready';

  constructor() {
    super('That CV is still being read');
  }
}

/** El CV elegido no se pudo leer (409). Hay que subir otro o reintentar la extracción. */
export class CvNotReadable extends MatchError {
  override readonly name = 'CvNotReadable';
  readonly code = 'cv_not_readable';

  constructor() {
    super('That CV could not be read');
  }
}

/**
 * La oferta no tiene título ni texto con los que comparar (409). Distinto de un link que no se ve: aquí la persona sí
 * lo ve, solo que todavía no hay descripción.
 */
export class JobNotReady extends MatchError {
  override readonly name = 'JobNotReady';
  readonly code = 'job_not_ready';

  constructor() {
    super('That job has no description yet');
  }
}

/** Ventana de análisis con informe no degradado agotada (429, con `Retry-After`). */
export class TooManyAnalysisAttempts extends MatchError {
  override readonly name = 'TooManyAnalysisAttempts';
  readonly code = 'too_many_attempts';

  constructor(readonly retryAfterSeconds: number) {
    super('Too many analysis attempts');
  }
}
