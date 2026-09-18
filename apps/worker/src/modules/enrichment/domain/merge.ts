import {
  PREVIEW_FIELD_NAMES,
  type JobPreview,
  type PreviewDraft,
  type PreviewFieldName,
  type PreviewSources,
  type StoredPreview,
} from '@linkvault/shared';

// Mezcla del preview con su procedencia por campo (D4 de link-enrichment, ADR-010). Son **dos reglas distintas**, no
// una, y C4 las separó por un motivo concreto:
//
// 1. **Dentro de una pasada** gana la etapa anterior de la cadena, que es la más fiable. El orden es total, así que no
//    hay empates que resolver.
// 2. **Frente a lo ya guardado** gana siempre lo nuevo automático, aunque venga de una etapa menos fiable que la que
//    escribió lo anterior: la página pudo cambiar. La única excepción es un campo `manual`, que no se toca nunca.
//
// Sin la segunda regla un preview equivocado sería inmutable para siempre y cualquier reextracción futura nacería
// rota. Sin la primera, la IA pisaría al JSON-LD dentro de la misma pasada.

/** Lo que el link guarda del preview: los valores y de dónde salió cada uno. */
export interface PreviewState {
  readonly preview: StoredPreview;
  readonly sources: PreviewSources;
}

/** Un link que nadie ha enriquecido ni editado todavía. */
export const EMPTY_PREVIEW_STATE: PreviewState = { preview: {}, sources: {} };

/** Cualquier valor del preview, sea de qué campo sea. */
type PreviewValue = JobPreview[PreviewFieldName];

/** Una entrada de procedencia sin atar a su campo, que es como la recorren los bucles de este archivo. */
type SourceEntry =
  | {
      value: PreviewValue;
      source: 'auto';
      extractor: string;
      at: string;
    }
  | {
      value: PreviewValue;
      source: 'manual';
      by: string;
      at: string;
      replaced?: { value: PreviewValue; extractor: string };
    };

/**
 * Las conversiones de este archivo son todas de la misma clase: `PreviewSources` ata el tipo del valor al campo
 * concreto, y un bucle sobre `PREVIEW_FIELD_NAMES` no puede llevar esa correspondencia consigo. Los valores salen de
 * `PreviewDraft` y de lo ya guardado, así que la forma es la que dice el contrato.
 */
function entriesOf(sources: PreviewSources): Record<string, SourceEntry> {
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
 * Regla 2: lo que la pasada propone entra sobre lo guardado, salvo en los campos que alguien escribió a mano. Un campo
 * que la pasada no propone conserva lo que ya había: la página puede haber dejado de publicar un dato sin que eso
 * signifique que el dato dejó de ser cierto.
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

    // Lo manual no se pisa nunca, ni siquiera por una extracción posterior que lea otra cosa.
    if (previous?.source === 'manual') {
      sources[name] = previous;
      preview[name] = previous.value;
      continue;
    }

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

/**
 * Una edición manual, con el valor automático que desplaza guardado en `replaced` para poder ofrecer "Volver a lo
 * extraído". Ediciones sucesivas conservan **el automático original**, no la edición anterior: a lo que se vuelve es a
 * lo que leyó la página, no a lo que otra persona escribió antes.
 *
 * La misma regla la aplica `applyManualEdit` en `apps/api/src/modules/links/domain/preview-edit.ts` (su función
 * `displacedBy`), que es el que corre cuando alguien edita de verdad: `api` escribe, el worker solo respeta lo escrito.
 * Están duplicadas a propósito —son dos módulos y el dominio de uno no puede importar el del otro—, así que **las dos
 * se cambian a la vez**: si divergen, "Volver a lo extraído" devolvería a cosas distintas según quién tocara el campo.
 */
export function applyManualField<Field extends PreviewFieldName>(
  stored: PreviewState,
  field: Field,
  value: JobPreview[Field],
  by: string,
  at: string,
): PreviewState {
  const previous = entriesOf(stored.sources)[field];
  const replaced =
    previous?.source === 'auto'
      ? { value: previous.value, extractor: previous.extractor }
      : previous?.replaced;

  const entry: SourceEntry = {
    value,
    source: 'manual',
    by,
    at,
    ...(replaced === undefined ? {} : { replaced }),
  };

  return {
    preview: { ...stored.preview, [field]: value },
    sources: {
      ...entriesOf(stored.sources),
      [field]: entry,
    } as PreviewSources,
  };
}
