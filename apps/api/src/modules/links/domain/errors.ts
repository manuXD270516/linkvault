// Errores de dominio del módulo `links` (specs links/job-link y links/sharing). Cada uno lleva el código de la API que le
// corresponde; el filtro de errores de presentación decide el estado HTTP. Nunca llevan la URL del usuario, el texto
// importado ni nombres: pueden acabar en un log.
//
// `group_not_found` no está aquí: quien no es miembro del grupo de destino recibe el error de `groups`, su dueño.

/** Códigos de `apiErrorCodeSchema` que produce el dominio de `links` (lo comprueba un test). */
export type LinksErrorCode =
  | 'invalid_url'
  | 'text_too_long'
  | 'link_not_found'
  | 'forbidden'
  | 'validation_error';

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
