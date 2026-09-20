// Formato de los identificadores que llegan por la URL (como en `groups`, `links` y `applications`). Uno con otra
// forma no identifica a nada: las consultas devuelven `null` o nada y el caso de uso responde el `404 cv_not_found`
// uniforme, en lugar de dejar que Mongo lance un `CastError` y salga un `500`.
//
// Lo aplican tanto el adaptador de Mongo como los dobles en memoria, para que los dos se comporten igual.

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

/** `true` si la cadena puede identificar a un CV. No dice que exista. */
export function isCvId(id: string): boolean {
  return OBJECT_ID_HEX.test(id);
}

/** `true` si la cadena puede identificar a una persona. */
export function isUserId(id: string): boolean {
  return OBJECT_ID_HEX.test(id);
}
