// Formato de los identificadores que llegan por la URL, el cuerpo o la query (como en `groups` y `links`). Uno con otra
// forma no identifica a nada: las consultas devuelven `null` o nada y el caso de uso responde el 404 uniforme, en lugar
// de dejar que Mongo lance un `CastError` y salga un 500.
//
// Lo aplican tanto el adaptador de Mongo como los dobles en memoria, para que ambos se comporten igual.

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

function isObjectIdHex(id: string): boolean {
  return OBJECT_ID_HEX.test(id);
}

/** `true` si la cadena puede identificar a una postulación. No dice que exista. */
export function isApplicationId(id: string): boolean {
  return isObjectIdHex(id);
}

/** `true` si la cadena puede identificar a un link. */
export function isLinkId(id: string): boolean {
  return isObjectIdHex(id);
}

/** `true` si la cadena puede identificar a un usuario. */
export function isUserId(id: string): boolean {
  return isObjectIdHex(id);
}
