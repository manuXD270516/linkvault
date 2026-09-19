import type {
  PreviewFieldName,
  PreviewSourceKind,
  PreviewSources,
  StoredPreview,
} from '@linkvault/shared';

// Piezas comunes a lo que una persona hace sobre el preview —escribir a mano, pegar la descripción, volver a lo
// anterior— (D3 de paste-job-description). Es dominio puro.
//
// Las funciones recorren el preview por nombre de campo, así que no pueden conservar el tipo del valor de cada uno;
// trabajan con `SourceEntry` y la conversión de vuelta a `PreviewSources` queda en quien las llama.

/** Entrada de procedencia sin su `replaced`: lo que un campo tiene y lo que guarda para deshacerse. */
export interface DisplacedEntry {
  readonly value: unknown;
  readonly source: PreviewSourceKind;
  readonly extractor?: string;
  readonly by?: string;
  /** Falta solo en un `replaced` de antes de paste-job-description, que nunca tuvo fecha. */
  readonly at?: string;
}

/** Entrada de procedencia tal y como la recorre este módulo, sin el tipo del valor de cada campo. */
export interface SourceEntry extends DisplacedEntry {
  readonly replaced?: DisplacedEntry;
}

/** Lo que había guardado de un link antes de que una persona actuara sobre su preview. */
export interface EditablePreview {
  readonly preview?: StoredPreview;
  readonly previewSources?: PreviewSources;
}

/** Preview y procedencia ya mezclados, y si la acción cambió algo. */
export interface EditedPreview {
  readonly preview: StoredPreview;
  readonly previewSources: PreviewSources;
  /** `false` cuando no había nada que cambiar: entonces no hay que subir la versión ni escribir. */
  readonly changed: boolean;
}

/** Copias mutables del preview y de su procedencia, recorribles por nombre de campo. */
export interface MutablePreview {
  readonly preview: Record<string, unknown>;
  readonly sources: Partial<Record<PreviewFieldName, SourceEntry>>;
}

export function mutableCopyOf(stored: EditablePreview): MutablePreview {
  return {
    preview: { ...stored.preview },
    sources: {
      ...(stored.previewSources as
        Partial<Record<PreviewFieldName, SourceEntry>> | undefined),
    },
  };
}

/** Vuelve a los tipos del contrato. Las claves son campos del preview y los valores salieron de sus schemas. */
export function editedFrom(
  draft: MutablePreview,
  changed: boolean,
): EditedPreview {
  return {
    preview: draft.preview as StoredPreview,
    previewSources: draft.sources as PreviewSources,
    changed,
  };
}

/**
 * La entrada que una persona desplaza, **completa** y sin su propio `replaced`: es lo que el campo guarda para que
 * "Volver a lo anterior" la devuelva tal cual era, con su origen, su extractor, su autor y su fecha. Deshacer llega un
 * nivel atrás.
 */
export function displacedEntryOf(entry: SourceEntry): DisplacedEntry {
  const { replaced: _replaced, ...displaced } = entry;
  return displaced;
}

/**
 * Igualdad por valor. Los valores del preview son datos JSON —cadenas, números, nulos, listas de habilidades o de
 * idiomas y el objeto del salario—, así que la comparación recorre listas y objetos planos en vez de fiarse de la
 * identidad de la referencia, que para lo que llega de una petición HTTP nunca se cumple.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    );
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && sameValue(a[key], b[key]))
    );
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
