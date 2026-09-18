import type {
  JobPreview,
  PreviewFieldName,
  PreviewSources,
} from '@linkvault/shared';
import {
  entriesOf,
  type DisplacedEntry,
  type PreviewState,
  type SourceEntry,
} from '../merge';

// Helper de test: lo que `api` escribe cuando alguien corrige un campo a mano (`applyManualEdit` en
// `apps/api/src/modules/links/domain/preview-edit.ts`). El worker nunca escribe a mano —solo respeta lo escrito—, así
// que esto no tiene llamador en producción (D3 de paste-job-description): existe para que los specs del worker partan
// de un preview como el que `api` deja, y para iterar sobre él la tabla `PREVIEW_REPLACED_CASES` de
// `@linkvault/testing`, que es el contrato que comparten los dos procesos.
//
// La regla que modela:
// - Sobre algo leído de la página o pegado, `replaced` guarda la entrada desplazada **completa** —valor, origen,
//   extractor, autor y fecha—, sin su propio `replaced`.
// - Sobre algo que ya escribió otra persona **no desplaza nada nuevo**: el campo conserva lo que ya guardaba, que es lo
//   que dijo la fuente. "Volver" desde un campo escrito a mano devuelve a la fuente, no a una corrección intermedia.

/** La entrada tal cual, sin su propio `replaced`: deshacer llega un nivel atrás. */
function displaced(entry: SourceEntry): DisplacedEntry {
  switch (entry.source) {
    case 'auto':
      return {
        value: entry.value,
        source: 'auto',
        extractor: entry.extractor,
        at: entry.at,
      };
    case 'pasted':
      return {
        value: entry.value,
        source: 'pasted',
        extractor: entry.extractor,
        by: entry.by,
        at: entry.at,
      };
    case 'manual':
      return {
        value: entry.value,
        source: 'manual',
        by: entry.by,
        at: entry.at,
      };
  }
}

export function applyManualField<Field extends PreviewFieldName>(
  stored: PreviewState,
  field: Field,
  value: JobPreview[Field],
  by: string,
  at: string,
): PreviewState {
  const previous = entriesOf(stored.sources)[field];
  const replaced =
    previous === undefined
      ? undefined
      : previous.source === 'manual'
        ? previous.replaced
        : displaced(previous);

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
