// Formato de los identificadores que llegan por la URL o por el cuerpo (mismo criterio que `groups`). Un `:id`, un
// `:linkId` o un `groupId` con otra forma no identifica a nada: las consultas devuelven `null`/`false` y el caso de uso
// responde su 404, en lugar de dejar que Mongo lance un `CastError` y salga un 500.
//
// Lo aplican tanto los adaptadores de Mongo como los dobles en memoria, para que ambos se comporten igual.

/** ObjectId en hexadecimal, la forma de los ids que emite Mongo. */
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

function isObjectIdHex(id: string): boolean {
  return OBJECT_ID_HEX.test(id);
}

/** `true` si la cadena puede identificar a un link. No dice que el link exista. */
export function isLinkId(id: string): boolean {
  return isObjectIdHex(id);
}

/** `true` si la cadena puede identificar a un grupo. No dice que el grupo exista. */
export function isGroupId(id: string): boolean {
  return isObjectIdHex(id);
}

/** `true` si la cadena puede identificar a un usuario. No dice que el usuario exista. */
export function isUserId(id: string): boolean {
  return isObjectIdHex(id);
}

/** `true` si la cadena puede identificar a un comentario. No dice que el comentario exista. */
export function isCommentId(id: string): boolean {
  return isObjectIdHex(id);
}
