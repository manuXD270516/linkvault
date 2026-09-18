import {
  PREVIEW_FIELD_NAMES,
  mayOverwrite,
  type JobPreview,
  type PreviewDraft,
  type PreviewFieldName,
  type PreviewSources,
  type StoredPreview,
} from '@linkvault/shared';

// Mezcla del preview con su procedencia por campo (D4 de link-enrichment, ADR-010, D3 de paste-job-description). Son
// **dos reglas distintas**, no una, y C4 las separó por un motivo concreto:
//
// 1. **Dentro de una pasada** gana la etapa anterior de la cadena, que es la más fiable. El orden es total, así que no
//    hay empates que resolver.
// 2. **Frente a lo ya guardado** gana siempre lo nuevo automático, aunque venga de una etapa menos fiable que la que
//    escribió lo anterior: la página pudo cambiar. Lo que no pisa nunca es un origen de rango superior —lo pegado y lo
//    escrito a mano—, y eso no lo decide este archivo sino `mayOverwrite` de `libs/shared`, la misma regla que usa el
//    pegado de `api`.
//
// Sin la segunda regla un preview equivocado sería inmutable para siempre y cualquier reextracción futura nacería
// rota. Sin la primera, la IA pisaría al JSON-LD dentro de la misma pasada.
//
// El worker no escribe nunca `replaced`: una relectura que cambia un valor automático por otro no guarda nada, porque
// nadie actuó y la tarjeta no debe ofrecer volver ahí. Lo que ya guardaba un campo pegado o manual se conserva entero
// con él.

/** Lo que el link guarda del preview: los valores y de dónde salió cada uno. */
export interface PreviewState {
  readonly preview: StoredPreview;
  readonly sources: PreviewSources;
}

/** Un link que nadie ha enriquecido ni editado todavía. */
export const EMPTY_PREVIEW_STATE: PreviewState = { preview: {}, sources: {} };

/** Cualquier valor del preview, sea de qué campo sea. */
export type PreviewValue = JobPreview[PreviewFieldName];

/**
 * La entrada que una persona desplazó al pegar o escribir a mano, completa y sin su propio `replaced`. Lo automático
 * puede no tener fecha: así se leen los `replaced` de antes de paste-job-description.
 */
export type DisplacedEntry =
  | {
      value: PreviewValue;
      source: 'auto';
      extractor: string;
      at?: string;
    }
  | {
      value: PreviewValue;
      source: 'pasted';
      extractor: string;
      by: string;
      at: string;
    }
  | {
      value: PreviewValue;
      source: 'manual';
      by: string;
      at: string;
    };

/** Una entrada de procedencia sin atar a su campo, que es como la recorren los bucles de este archivo. */
export type SourceEntry =
  | {
      value: PreviewValue;
      source: 'auto';
      extractor: string;
      at: string;
    }
  | {
      value: PreviewValue;
      source: 'pasted';
      extractor: string;
      by: string;
      at: string;
      replaced?: DisplacedEntry;
    }
  | {
      value: PreviewValue;
      source: 'manual';
      by: string;
      at: string;
      replaced?: DisplacedEntry;
    };

/**
 * Las conversiones de este archivo son todas de la misma clase: `PreviewSources` ata el tipo del valor al campo
 * concreto, y un bucle sobre `PREVIEW_FIELD_NAMES` no puede llevar esa correspondencia consigo. Los valores salen de
 * `PreviewDraft` y de lo ya guardado, así que la forma es la que dice el contrato.
 */
export function entriesOf(
  sources: PreviewSources,
): Record<string, SourceEntry> {
  return sources as Record<string, SourceEntry>;
}

function valuesOf(preview: StoredPreview): Record<string, PreviewValue> {
  return preview as Record<string, PreviewValue>;
}

/**
 * Regla 1: dentro de una misma pasada, entre dos valores automáticos gana el de la etapa anterior. Los borradores
 * llegan en el orden de la cadena, así que el primero que propone un campo se lo queda.
 */
export function mergeDrafts(drafts: readonly PreviewDraft[]): PreviewDraft {
  const merged: Record<string, unknown> = {};
  for (const draft of drafts) {
    for (const name of PREVIEW_FIELD_NAMES) {
      const field = draft[name];
      if (field !== undefined && merged[name] === undefined) {
        merged[name] = field;
      }
    }
  }
  return merged as PreviewDraft;
}

/**
 * Regla 2: lo que la pasada propone entra sobre lo guardado, salvo en los campos que `mayOverwrite` protege de lo
 * automático: los pegados y los escritos a mano. Un campo que la pasada no propone conserva lo que ya había: la página
 * puede haber dejado de publicar un dato sin que eso signifique que el dato dejó de ser cierto.
 *
 * `at` es el instante de esta pasada, en ISO. No lo calcula el dominio: se lo pasa el caso de uso desde su reloj.
 */
export function mergeIntoStored(
  stored: PreviewState,
  draft: PreviewDraft,
  at: string,
): PreviewState {
  const storedEntries = entriesOf(stored.sources);
  const storedValues = valuesOf(stored.preview);
  const preview: Record<string, PreviewValue> = {};
  const sources: Record<string, SourceEntry> = {};

  for (const name of PREVIEW_FIELD_NAMES) {
    const previous = storedEntries[name];
    const proposed = draft[name];

    // Lo pegado y lo escrito a mano no se pisan, ni siquiera con una extracción posterior que lea otra cosa; y se
    // conservan enteros, con lo que guardaban para deshacerse.
    if (previous !== undefined && !mayOverwrite(previous.source, 'auto')) {
      sources[name] = previous;
      preview[name] = previous.value;
      continue;
    }

    // Lo automático sustituye a lo automático sin guardar lo que sustituye: nadie actuó, no hay a qué volver.
    if (proposed !== undefined) {
      sources[name] = {
        value: proposed.value,
        source: 'auto',
        extractor: proposed.extractor,
        at,
      };
      preview[name] = proposed.value;
      continue;
    }

    if (previous !== undefined) {
      sources[name] = previous;
      preview[name] = previous.value;
      continue;
    }

    // Un valor guardado sin procedencia (por ejemplo, de antes de que existiera) se conserva tal cual.
    if (storedValues[name] !== undefined) preview[name] = storedValues[name];
  }

  return {
    preview: preview as StoredPreview,
    sources: sources as PreviewSources,
  };
}
