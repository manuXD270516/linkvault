// Clave del objeto en el almacén (D1 de cv-upload-extract, ADR-028 §1). Vive aquí porque la componen dos procesos: la
// API al subir el archivo y el worker al leerlo y al borrarlo. Dos formas de nombrar el mismo objeto serían dos formas
// de perderlo.
//
// La clave **no dice nada**: ni el nombre del archivo ni su extensión. Una clave como
// `ana/CV Ana Pérez - Backend.pdf` publicaría el nombre de una persona en el listado de un bucket, en un mensaje de
// error del SDK y en cualquier traza. El tipo se guarda en Mongo (`fileType`), que es donde se consulta.
//
// El prefijo por usuario existe para que un operador pueda encontrar y borrar de una vez todo lo de una persona
// (`mc rm --recursive <bucket>/<userId>/`, RUNBOOK), que es justo lo que el borrado de cuenta necesitará.

/** `<userId>/<cvId>`, estable para los mismos identificadores. */
export function cvFileKey(userId: string, cvId: string): string {
  return `${userId}/${cvId}`;
}
