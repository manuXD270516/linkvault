// Escapado del HTML de la página pública (D4 de public-preview-share). A mano y sin motor de plantillas: añadir uno a
// `api` por una página sería una dependencia más y un segundo juego de reglas de escapado que mantener; Mustache ya se
// usa en `libs/ai` para los prompts, donde **no** se escapa HTML, y mezclar los dos usos invita a un error.
//
// NO hay ninguna función de serialización a JavaScript: la página no lleva `<script>` (el salto va solo con
// `<meta http-equiv="refresh">`), así que no hay nada que serializar dentro de un bloque de JavaScript y desaparece esa
// superficie entera, incluida la del `</script>` dentro de una cadena.

const ENTITIES: ReadonlyMap<string, string> = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

/**
 * Sustituye `& < > " '` por sus entidades. Se aplica a **todo** valor que entra en el HTML, esté en un texto o dentro
 * de un atributo: las comillas de los dos tipos van escapadas para que un valor no pueda salirse de su atributo.
 *
 * El `&` va primero por construcción: se recorre la cadena una sola vez, así que una entidad recién escrita no se
 * vuelve a escapar.
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ENTITIES.get(character) ?? character);
}
