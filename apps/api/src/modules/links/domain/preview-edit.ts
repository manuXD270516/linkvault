import { isPreviewFieldName, type PreviewFieldName } from '@linkvault/shared';
import { PreviewFieldUnknown } from './errors';
import {
  displacedEntryOf,
  editedFrom,
  mutableCopyOf,
  sameValue,
  type DisplacedEntry,
  type EditablePreview,
  type EditedPreview,
  type MutablePreview,
  type SourceEntry,
} from './preview-entry';

// Edición manual del preview (D4 de link-enrichment, D3 de paste-job-description, spec links/enrichment). Es dominio
// puro: recibe lo que había guardado y lo que la persona envió, y devuelve lo que hay que guardar. Quién puede editar,
// la versión con la que se escribe y el 404 de un link que no se ve son de la capa de aplicación.
//
// Las reglas:
// - Un campo escrito a mano guarda en `replaced` la entrada que desplaza **completa** —valor, origen, extractor, autor
//   y fecha—, sin su propio `replaced`: lo leído de la página o lo pegado por alguien.
// - Escribir a mano sobre lo que ya estaba escrito a mano **no desplaza nada nuevo**: se conserva el `replaced` que
//   ese campo traía. "Volver" desde un campo escrito a mano devuelve a la fuente —la página o el pegado—, no a una
//   corrección intermedia de otra persona.
// - "Volver a lo anterior" en un campo escrito a mano o pegado le devuelve la entrada que guardaba, tal cual, con su
//   origen y su autor. Un `replaced` de antes de este change no tenía fecha: vuelve con la de ahora. Un campo que no
//   había desplazado nada queda **sin valor**: lo anterior era nada, y dejar ahí lo que se acaba de deshacer sería no
//   hacer nada con un 200 delante.
// - Un campo que llega con el valor que ya tenía escrito a mano no cuenta como cambio, y por eso una misma edición
//   enviada dos veces no sube `previewVersion`: la segunda no tendría nada que guardar y sí mataría un
//   enriquecimiento en vuelo.
//
// Los `revert` se aplican antes que los `fields`: así, si la misma petición devuelve un campo a lo anterior y escribe
// otro valor encima, gana el valor nuevo y su `replaced` es la entrada recién recuperada.

/** Cambios que envía una persona: valores nuevos por campo y campos que vuelven a su entrada anterior. */
export interface ManualPreviewEdit {
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly revert?: readonly string[];
}

export type { EditablePreview, EditedPreview } from './preview-entry';

/**
 * Preview con los cambios de una persona aplicados. Lanza `PreviewFieldUnknown` en cuanto aparece un nombre que no es
 * un campo del preview, nombrándolo: el contrato deja pasar los desconocidos justo para que la respuesta pueda decir
 * cuál es en vez de un `validation_error` que el SPA no sabría explicar.
 */
export function applyManualEdit(
  stored: EditablePreview,
  edit: ManualPreviewEdit,
  by: string,
  now: Date,
): EditedPreview {
  const draft = mutableCopyOf(stored);
  const at = now.toISOString();
  let changed = false;

  for (const name of edit.revert ?? []) {
    changed = revertField(draft, requireField(name), at) || changed;
  }
  for (const [name, value] of Object.entries(edit.fields ?? {})) {
    const field = requireField(name);
    const previous = draft.sources[field];
    // Un campo que ya estaba escrito a mano con ese mismo valor no es un cambio: el SPA reenvía el formulario entero,
    // y subir la versión por un valor que no se movió mataría un enriquecimiento en vuelo a cambio de nada. Escribir a
    // mano lo que puso la extracción sí cambia algo —fija el campo y guarda lo desplazado—, así que no entra aquí.
    if (alreadyWrittenByHand(previous, draft.preview[field], value)) {
      continue;
    }
    const replaced = displacedByHand(previous);
    draft.preview[field] = value;
    draft.sources[field] = {
      value,
      source: 'manual',
      by,
      at,
      ...(replaced === undefined ? {} : { replaced }),
    };
    changed = true;
  }

  return editedFrom(draft, changed);
}

/**
 * Si ese campo ya lo escribió una persona con ese mismo valor. Se compara contra la procedencia y contra lo guardado a
 * la vez: los dos tienen que decir lo mismo para que no escribir sea, de verdad, no cambiar nada.
 */
function alreadyWrittenByHand(
  entry: SourceEntry | undefined,
  stored: unknown,
  value: unknown,
): boolean {
  return (
    entry?.source === 'manual' &&
    sameValue(entry.value, value) &&
    sameValue(stored, value)
  );
}

function requireField(name: string): PreviewFieldName {
  if (!isPreviewFieldName(name)) {
    throw new PreviewFieldUnknown(name);
  }
  return name;
}

/**
 * Lo que un campo escrito a mano guarda para deshacerse: la entrada que desplaza, completa, si era de la página o
 * pegada; y si ya estaba escrita a mano, lo que esa guardaba —la fuente—, no la corrección anterior.
 *
 * El worker modela lo mismo en `applyManualField`, hoy un helper solo de test
 * (`apps/worker/src/modules/enrichment/domain/testing/manual-field.ts`), porque el worker nunca escribe a mano. Lo que
 * mantiene alineadas las dos copias no es esa función: es `mayOverwrite` de `libs/shared`, el orden de quién pisa a
 * quién que usan los dos procesos, y la tabla `PREVIEW_REPLACED_CASES` de `@linkvault/testing`, que los specs de los
 * dos lados recorren. Si esta regla cambia, la tabla cambia con ella y el spec del worker se pone en rojo.
 */
function displacedByHand(
  previous: SourceEntry | undefined,
): DisplacedEntry | undefined {
  if (previous === undefined) {
    return undefined;
  }
  return previous.source === 'manual'
    ? previous.replaced
    : displacedEntryOf(previous);
}

/**
 * Devuelve el campo a la entrada que guardaba. `false` si no había nada que deshacer: un campo que nadie ha escrito ni
 * pegado, o uno leído de la página, que nunca guarda nada.
 */
function revertField(
  draft: MutablePreview,
  name: PreviewFieldName,
  at: string,
): boolean {
  const entry = draft.sources[name];
  if (entry === undefined || entry.source === 'auto') {
    return false;
  }
  const replaced = entry.replaced;
  if (replaced === undefined) {
    // Lo anterior era nada: el campo vuelve a estar sin escribir por nadie.
    delete draft.preview[name];
    delete draft.sources[name];
    return true;
  }
  draft.preview[name] = replaced.value;
  draft.sources[name] = {
    ...replaced,
    // Un `replaced` de antes de paste-job-description no tenía fecha, y la entrada de un campo siempre la lleva.
    at: replaced.at ?? at,
  };
  return true;
}
