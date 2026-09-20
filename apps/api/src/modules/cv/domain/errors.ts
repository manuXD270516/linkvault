// Errores de dominio del módulo `cv` (specs `cv/documents`). Cada uno lleva el código de la API que le corresponde; el
// filtro de errores de presentación decide el estado HTTP.
//
// **Ninguno lleva el nombre del archivo, su texto ni la clave del objeto** (D10, ADR-028 §10): un error acaba en un log
// más a menudo de lo que parece, y lo que no se escribe no se puede filtrar.

/** Códigos de `apiErrorCodeSchema` que produce el dominio de `cv` (lo comprueba un test). */
export type CvErrorCode =
  | 'cv_not_found'
  | 'unsupported_file_type'
  | 'file_too_large'
  | 'too_many_cvs'
  | 'too_many_attempts'
  | 'validation_error';

export abstract class CvError extends Error {
  abstract readonly code: CvErrorCode;
}

/**
 * El CV no existe, es de otra persona o su identificador está mal formado (404). Los tres casos comparten error y
 * cuerpo: distinguir "no existe" de "no es tuyo" le diría a un extraño que ese identificador existe. El caso realista
 * no es un ataque, sino haberlo borrado en otra pestaña.
 */
export class CvNotFound extends CvError {
  override readonly name = 'CvNotFound';
  readonly code = 'cv_not_found';

  constructor() {
    super('CV not found');
  }
}

/**
 * Ni PDF ni DOCX, o sus bytes, su extensión y su `Content-Type` no apuntan al mismo tipo (415). Se decide con el primer
 * trozo del archivo: nada se sube ni se escribe.
 */
export class UnsupportedCvFile extends CvError {
  override readonly name = 'UnsupportedCvFile';
  readonly code = 'unsupported_file_type';

  constructor() {
    super('Unsupported CV file type');
  }
}

/** El archivo pasa de `CV_MAX_FILE_BYTES` (413). No queda nada a medias en el almacén. */
export class CvFileTooLarge extends CvError {
  override readonly name = 'CvFileTooLarge';
  readonly code = 'file_too_large';

  constructor() {
    super('CV file is too large');
  }
}

/**
 * La petición de subida no trae una parte de archivo utilizable (400 `validation_error` nombrando `file`). Es adonde
 * van a parar **todos** los errores del parser de multipart que no tienen una fila propia, incluido el caso de no
 * mandar parte ninguna, que no produce error: la lista de códigos es del plugin y crece con una versión menor, así que
 * una rama nueva no puede convertirse en un `500`.
 */
export class InvalidCvUpload extends CvError {
  override readonly name = 'InvalidCvUpload';
  readonly code = 'validation_error';
  readonly field = 'file';

  constructor() {
    super('Invalid CV upload');
  }
}

/** Ya hay `MAX_CV_DOCUMENTS` CV guardados (409). Ninguno se borra solo: la persona elige cuál quitar. */
export class TooManyCvDocuments extends CvError {
  override readonly name = 'TooManyCvDocuments';
  readonly code = 'too_many_cvs';

  constructor() {
    super('Too many stored CVs');
  }
}

/** Ventana de subidas, de vistas previas o de rechazos agotada (429, con `Retry-After`). */
export class TooManyCvAttempts extends CvError {
  override readonly name = 'TooManyCvAttempts';
  readonly code = 'too_many_attempts';

  constructor(readonly retryAfterSeconds: number) {
    super('Too many CV attempts');
  }
}
