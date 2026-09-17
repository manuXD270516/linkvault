// Formato de los identificadores que llegan por la URL (D2 de groups). Un `:id` o un `:userId` con otra forma no
// identifica a nada: las consultas devuelven `null`/`false` y el caso de uso responde el 404 uniforme, en lugar de dejar
// que Mongo lance un `CastError` y salga un 500 que además distinguiría un id mal formado de un grupo ajeno.
//
// Lo aplican tanto el adaptador de Mongo como los dobles en memoria, para que ambos se comporten igual.

/**
 * ObjectId en hexadecimal, la forma de los ids que emite Mongo. Las cadenas de 12 bytes que `isValidObjectId` acepta
 * quedan fuera a propósito: ningún id emitido por la API tiene esa forma.
 */
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

function isObjectIdHex(id: string): boolean {
  return OBJECT_ID_HEX.test(id);
}

/** `true` si la cadena puede identificar a un grupo. No dice que el grupo exista. */
export function isGroupId(id: string): boolean {
  return isObjectIdHex(id);
}

/** `true` si la cadena puede identificar a un usuario. No dice que el usuario exista. */
export function isUserId(id: string): boolean {
  return isObjectIdHex(id);
}
