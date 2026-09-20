// Errores de dominio del módulo `links` (specs links/job-link y links/sharing). Cada uno lleva el código de la API que le
// corresponde; el filtro de errores de presentación decide el estado HTTP. Nunca llevan la URL del usuario, el texto
// importado ni nombres: pueden acabar en un log.
//
// `group_not_found` casi nunca está aquí: quien no es miembro del grupo de destino recibe el error de `groups`, su dueño.
// La excepción es `CommentsGroupNotFound`: los casos de uso de comentarios y notas (group-comments) no importan el
// dominio de `groups` (critic 16) y responden con este, que tiene el mismo código y el mismo cuerpo.

/** Códigos de `apiErrorCodeSchema` que produce el dominio de `links` (lo comprueba un test). */
export type LinksErrorCode =
  | 'invalid_url'
  | 'text_too_long'
  | 'link_not_found'
  | 'comment_not_found'
  | 'group_not_found'
  | 'forbidden'
  | 'preview_field_unknown'
  | 'enrichment_not_retryable'
  | 'too_many_attempts'
  | 'validation_error'
  | 'not_a_job_posting'
  | 'extraction_unavailable'
  | 'ai_quota_exceeded';

export abstract class LinksError extends Error {
  abstract readonly code: LinksErrorCode;
}

/**
 * La URL no es `http(s)`, no tiene host, no es una URL o pasa del máximo de caracteres (400). Los cuatro casos comparten
 * error: para el usuario son lo mismo, "eso no parece un enlace de una oferta".
 */
export class InvalidUrl extends LinksError {
  override readonly name = 'InvalidUrl';
  readonly code = 'invalid_url';
  /** Campo de la petición que nombra la respuesta. */
  readonly field = 'url';

  constructor() {
    super('That does not look like a job link');
  }
}

/** El texto de la importación pasa del máximo de caracteres (400). El texto NO viaja en el error: no se registra nunca. */
export class TextTooLong extends LinksError {
  override readonly name = 'TextTooLong';
  readonly code = 'text_too_long';
  /** Campo de la petición que nombra la respuesta. */
  readonly field = 'text';

  constructor() {
    super('Text is too long');
  }
}

/** El link no está en ese grupo ni en esa lista privada, o su `:linkId` no tiene formato de identificador (404). */
export class LinkNotFound extends LinksError {
  override readonly name = 'LinkNotFound';
  readonly code = 'link_not_found';

  constructor() {
    super('Link not found');
  }
}

/**
 * Quien pide es miembro del grupo pero no compartió el link ni es `owner` (403). Es un error distinto de `LinkNotFound`
 * a propósito: el usuario ya ve el link en la lista, así que no hay nada que ocultarle.
 */
export class LinkRemovalForbidden extends LinksError {
  override readonly name = 'LinkRemovalForbidden';
  readonly code = 'forbidden';

  constructor() {
    super('Only the member who shared the link or the group owner can remove it');
  }
}

/** Cursor de paginación manipulado o de otra lista (400 nombrando `cursor`). Su contenido nunca sale en la respuesta. */
export class InvalidCursor extends LinksError {
  override readonly name = 'InvalidCursor';
  readonly code = 'validation_error';
  /** Campo de la petición que nombra la respuesta. */
  readonly field = 'cursor';

  constructor() {
    super('Invalid cursor');
  }
}

/**
 * La edición manual nombró un campo que no existe en el preview (400). Lleva el campo **dentro del error** para que la
 * respuesta lo nombre: "no conozco ese campo" sin decir cuál obligaría a quien lo envió a adivinar. El nombre viene de
 * la petición, así que el contrato ya lo acotó en longitud antes de llegar aquí; no es un dato personal.
 */
export class PreviewFieldUnknown extends LinksError {
  override readonly name = 'PreviewFieldUnknown';
  readonly code = 'preview_field_unknown';

  constructor(readonly field: string) {
    super('Unknown preview field');
  }
}

/**
 * Se pidió volver a leer una oferta que no se puede volver a leer (409): la bolsa prohíbe la lectura, la bolsa nos
 * bloquea o lo compartido no era una oferta. Volver a pedir lo que un sitio ya negó es exactamente el daño que ADR-003
 * quiere evitar, así que no es un fallo transitorio que reintentar sino una respuesta definitiva.
 */
export class EnrichmentNotRetryable extends LinksError {
  override readonly name = 'EnrichmentNotRetryable';
  readonly code = 'enrichment_not_retryable';

  constructor() {
    super('That link cannot be read automatically');
  }
}

/**
 * Se agotó el límite de la ventana (429): reintentos de lectura de un link o importaciones de una persona. `links` tiene
 * el suyo y no el de `auth` porque el dominio de un módulo no importa el de otro (ADR-020 §6); lo que comparten es el
 * limitador de infraestructura, no el error.
 */
export class TooManyLinkAttempts extends LinksError {
  override readonly name = 'TooManyLinkAttempts';
  readonly code = 'too_many_attempts';
  /** Segundos hasta que la ventana se reinicia; sale en `Retry-After`, entero y como mínimo 1, igual que en `auth`. */
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Too many attempts');
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

/**
 * Lo pegado no es una oferta (422): se queda vacío sin sus datos de contacto, o la IA respondió que no es una vacante
 * (spec links/pasted-description). El link no cambia.
 */
export class NotAJobPosting extends LinksError {
  override readonly name = 'NotAJobPosting';
  readonly code = 'not_a_job_posting';

  constructor() {
    super('That does not look like a job posting');
  }
}

/**
 * No se pudo leer lo pegado ahora (503): la IA degradó o no respondió a tiempo, o el contador de pegados no responde y
 * el límite falla cerrado (D5). Es transitorio, así que lleva `Retry-After`; y no gasta el intento de quien pegó.
 */
export class ExtractionUnavailable extends LinksError {
  override readonly name = 'ExtractionUnavailable';
  readonly code = 'extraction_unavailable';
  /** Segundos que se anuncian en `Retry-After`, enteros y como mínimo 1. */
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('The pasted text could not be read right now');
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

/**
 * Quien pega agotó su cuota diaria de IA (429). Distinto de `TooManyLinkAttempts`, cuya ventana es de minutos: decir
 * "inténtalo en un rato" sería mentira cuando hay que esperar al día siguiente (D5).
 */
export class AiQuotaExceeded extends LinksError {
  override readonly name = 'AiQuotaExceeded';
  readonly code = 'ai_quota_exceeded';
  /** Segundos que se anuncian en `Retry-After`: la ventana entera de la cuota, porque la política solo dice sí o no. */
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('The daily AI quota is exhausted');
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

// Comentarios y nota de quien comparte (D1, D4 y D10 de group-comments). Ninguno lleva el texto del comentario o de la
// nota: pueden acabar en un log.

/**
 * Base de los errores de un campo de la petición que solo el dominio puede juzgar (400 `validation_error` nombrando
 * `field`). El filtro HTTP tiene una rama para ella antes de la de `LinksError`, como `InvalidApplicationField`.
 */
export abstract class InvalidLinkField extends LinksError {
  readonly code = 'validation_error';
  /** Campo de la petición que nombra la respuesta. */
  abstract readonly field: string;
}

/** El texto de un comentario queda vacío tras normalizarse o pasa de 500 caracteres (400 nombrando `text`). */
export class InvalidCommentText extends InvalidLinkField {
  override readonly name = 'InvalidCommentText';
  readonly field = 'text';

  constructor() {
    super('Invalid comment text');
  }
}

/** La nota de quien comparte pasa de 280 caracteres tras normalizarse (400 nombrando `note`). */
export class InvalidShareNote extends InvalidLinkField {
  override readonly name = 'InvalidShareNote';
  readonly field = 'note';

  constructor() {
    super('Invalid share note');
  }
}

/**
 * El comentario no existe, ya se borró, es de otro link o de otro grupo, o su `:commentId` no tiene formato de
 * identificador (404). Los cinco casos responden lo mismo.
 */
export class CommentNotFound extends LinksError {
  override readonly name = 'CommentNotFound';
  readonly code = 'comment_not_found';

  constructor() {
    super('Comment not found');
  }
}

/**
 * Quien pide es miembro del grupo pero no escribió el comentario ni es `owner` (403). No es un 404: ya ve ese comentario
 * en el hilo, así que no hay nada que ocultarle (mismo criterio que `LinkRemovalForbidden`).
 */
export class CommentDeletionForbidden extends LinksError {
  override readonly name = 'CommentDeletionForbidden';
  readonly code = 'forbidden';

  constructor() {
    super('Only the author or the group owner can delete a comment');
  }
}

/** Quien pide es miembro del grupo pero no compartió el link ni es `owner` (403), haya o no nota. */
export class NoteRemovalForbidden extends LinksError {
  override readonly name = 'NoteRemovalForbidden';
  readonly code = 'forbidden';

  constructor() {
    super('Only the member who shared the link or the group owner can remove its note');
  }
}

// Enlace público de un link compartido (D2 de public-preview-share). Ninguno lleva el slug ni la URL: pueden acabar en
// un log, y el slug es la llave de una página que cualquiera puede abrir.

/**
 * Quien pide es miembro del grupo pero no compartió el link ni es `owner` (403), **esté o no publicado**. El mismo
 * criterio que `NoteRemovalForbidden`: la respuesta no le dice a quien no puede tocarlo si el link estaba publicado.
 */
export class PublicShareForbidden extends LinksError {
  override readonly name = 'PublicShareForbidden';
  readonly code = 'forbidden';

  constructor() {
    super(
      'Only the member who shared the link or the group owner can change its public link',
    );
  }
}

/**
 * El link no está en ese grupo, su `:linkId` no tiene formato de identificador, o la relación desapareció entre la
 * comprobación y la escritura (404 `link_not_found`).
 */
export class PublicShareNotFound extends LinksError {
  override readonly name = 'PublicShareNotFound';
  readonly code = 'link_not_found';

  constructor() {
    super('Link not found');
  }
}

/**
 * Quien pide no es miembro del grupo, el grupo no existe o su `:id` está mal formado (404 `group_not_found`, el mismo
 * cuerpo que da `groups`). Propio de `links` para que los casos de uso de comentarios no importen el dominio de
 * `groups` (critic 16).
 */
export class CommentsGroupNotFound extends LinksError {
  override readonly name = 'CommentsGroupNotFound';
  readonly code = 'group_not_found';

  constructor() {
    super('Group not found');
  }
}
