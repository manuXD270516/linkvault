// Formato de los identificadores que llegan por la URL. Uno con otra forma no identifica a nada: las consultas
// devuelven `null` o nada y el caso de uso responde el `404` uniforme, en lugar de dejar que Mongo lance un
// `CastError` y salga un `500`.

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

/** `true` si la cadena puede identificar a un análisis. No dice que exista. */
export function isAnalysisId(id: string): boolean {
  return OBJECT_ID_HEX.test(id);
}

/** `true` si la cadena puede identificar a una persona. */
export function isUserId(id: string): boolean {
  return OBJECT_ID_HEX.test(id);
}

/** `true` si la cadena puede identificar a una oferta. */
export function isLinkId(id: string): boolean {
  return OBJECT_ID_HEX.test(id);
}

/** `true` si la cadena puede identificar a un CV. */
export function isCvId(id: string): boolean {
  return OBJECT_ID_HEX.test(id);
}
