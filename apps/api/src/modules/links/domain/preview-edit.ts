import {
  isPreviewFieldName,
  type PreviewSources,
  type StoredPreview,
} from '@linkvault/shared';
import { PreviewFieldUnknown } from './errors';

// Edición manual del preview (D4 de link-enrichment, spec links/enrichment). Es dominio puro: recibe lo que había
// guardado y lo que la persona envió, y devuelve lo que hay que guardar. Quién puede editar, la versión con la que se
// escribe y el 404 de un link que no se ve son de la capa de aplicación.
//
// Dos reglas y una consecuencia:
// - Un campo escrito a mano guarda en `replaced` el valor **automático** que desplaza, para poder ofrecer "Volver a lo
//   extraído". Si lo que desplaza ya era manual, se conserva el `replaced` que ese campo traía: si no, volver a lo
//   extraído devolvería a otra edición manual y no a lo que leyó la máquina, que es lo que la acción promete.
// - "Volver a lo extraído" de un campo que nunca tuvo valor automático lo deja **sin valor**: lo extraído era nada, y
//   dejar ahí la edición que se acaba de deshacer sería no hacer nada con un 200 delante.
//
// Los `revert` se aplican antes que los `fields`: así, si la misma petición devuelve un campo a lo extraído y escribe
// otro valor encima, gana el valor nuevo y su `replaced` es el automático recién recuperado.

/** Cambios que envía una persona: valores nuevos por campo y campos que vuelven a su valor automático anterior. */
export interface ManualPreviewEdit {
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly revert?: readonly string[];
}

/** Preview y procedencia ya mezclados, y si la petición cambió algo. */
export interface EditedPreview {
  readonly preview: StoredPreview;
  readonly previewSources: PreviewSources;
  /** `false` cuando la petición no pedía nada que cambiar: entonces no hay que subir la versión ni escribir. */
  readonly changed: boolean;
}

/** Lo que había guardado de un link antes de la edición. */
export interface EditablePreview {
  readonly preview?: StoredPreview;
  readonly previewSources?: PreviewSources;
}

/** Entrada de procedencia tal y como la recorre este módulo, sin el tipo del valor de cada campo. */
interface SourceEntry {
  readonly value: unknown;
  readonly source: 'auto' | 'manual';
  readonly extractor?: string;
  readonly by?: string;
  readonly at: string;
  readonly replaced?: { readonly value: unknown; readonly extractor: string };
}

/**
 * Preview con los cambios de una persona aplicados. Lanza `PreviewFieldUnknown` en cuanto aparece un nombre que no es
 * un campo del preview, nombrándolo: el contrato deja pasar los desconocidos justo para que la respuesta pueda decir
 * cuál es en vez de un `validation_error` que el SPA no sabría explicar.
 *
 * El recorrido es por nombre de campo, así que los tipos por campo de `StoredPreview` y `PreviewSources` no se pueden
 * conservar dentro; la conversión queda acotada a esta función y lo que sale de ella vuelve a estar tipado.
 */
export function applyManualEdit(
  stored: EditablePreview,
  edit: ManualPreviewEdit,
  by: string,
  now: Date,
): EditedPreview {
  const preview: Record<string, unknown> = { ...stored.preview };
  const sources: Record<string, SourceEntry> = {
    ...(stored.previewSources as Record<string, SourceEntry> | undefined),
  };
  const at = now.toISOString();
  let changed = false;

  for (const name of edit.revert ?? []) {
    requireField(name);
    changed = revertField(preview, sources, name, at) || changed;
  }
  for (const [name, value] of Object.entries(edit.fields ?? {})) {
    requireField(name);
    preview[name] = value;
    sources[name] = {
      value,
      source: 'manual',
      by,
      at,
      ...(displacedBy(sources[name]) === undefined
        ? {}
        : { replaced: displacedBy(sources[name]) }),
    };
    changed = true;
  }

  return {
    preview: preview as StoredPreview,
    previewSources: sources as PreviewSources,
    changed,
  };
}

function requireField(name: string): void {
  if (!isPreviewFieldName(name)) {
    throw new PreviewFieldUnknown(name);
  }
}

/**
 * Lo automático que una edición desplaza: el valor de la entrada si era automática, o el que ya traía si era manual.
 *
 * La misma regla vive en `applyManualField`, en `apps/worker/src/modules/enrichment/domain/merge.ts`, porque el worker
 * necesita el mismo modelo del preview para mezclar una reextracción sin pisar lo manual. Están duplicadas a propósito
 * —son dos módulos y el dominio de uno no puede importar el del otro—, así que **las dos se cambian a la vez**: si
 * divergen, "Volver a lo extraído" devolvería a cosas distintas según quién tocara el campo.
 */
function displacedBy(
  previous: SourceEntry | undefined,
): { value: unknown; extractor: string } | undefined {
  if (previous === undefined) {
    return undefined;
  }
  if (previous.source === 'manual') {
    return previous.replaced;
  }
  return previous.extractor === undefined
    ? undefined
    : { value: previous.value, extractor: previous.extractor };
}

/** Devuelve el campo a su valor automático anterior. `false` si no había ninguna edición manual que deshacer. */
function revertField(
  preview: Record<string, unknown>,
  sources: Record<string, SourceEntry>,
  name: string,
  at: string,
): boolean {
  const entry = sources[name];
  if (entry === undefined || entry.source !== 'manual') {
    return false;
  }
  const replaced = entry.replaced;
  if (replaced === undefined) {
    // Lo extraído era nada: el campo vuelve a estar sin escribir por nadie.
    delete preview[name];
    delete sources[name];
    return true;
  }
  preview[name] = replaced.value;
  sources[name] = {
    value: replaced.value,
    source: 'auto',
    extractor: replaced.extractor,
    at,
  };
  return true;
}
