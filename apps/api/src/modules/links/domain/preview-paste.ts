import {
  PASTED_PREVIEW_EXTRACTOR,
  PREVIEW_FIELD_NAMES,
  draftFrom,
  hasRequiredFields,
  mayOverwrite,
  type EnrichmentFailureReason,
  type JobPreview,
  type LastEnrichmentError,
  type PreviewSources,
  type PreviewStatus,
  type StoredPreview,
} from '@linkvault/shared';
import {
  displacedEntryOf,
  editedFrom,
  mutableCopyOf,
  sameValue,
  type EditablePreview,
  type EditedPreview,
  type MutablePreview,
} from './preview-entry';

// Completar el preview pegando la descripción (D3 y D6 de paste-job-description, spec links/pasted-description). Es
// dominio puro: recibe lo que había guardado, lo que la IA leyó del texto y el título y la empresa escritos aparte, y
// devuelve lo que hay que guardar. El texto pegado no llega aquí: solo lo que se derivó de él.
//
// Las reglas:
// - **Pegar solo escribe campos con valor.** Lo que la IA devuelve como `null`, `''`, `[]` o `'unknown'` no borra lo
//   que la página ya había dado: lo filtra `draftFrom`, el mismo filtro que usa el merge del worker.
// - Quién pisa a quién lo decide `mayOverwrite`: pegar sustituye lo leído de la página y lo pegado antes, y **nunca
//   toca un campo escrito a mano, ni lo que ese campo guarda para deshacerse**.
// - Lo que sustituye guarda en `replaced` la entrada desplazada completa, para poder volver a ella.
// - **Lo que no cambia de valor no cambia de autor.** Un campo al que lo pegado da el valor que ya tenía se queda como
//   estaba: si no, cada pegado sobre un link ya leído atribuiría a quien pega lo que dijo la página.
// - El título y la empresa escritos aparte cuentan como escritos a mano **solo si difieren de lo que el link ya
//   tenía**. El diálogo los precarga con lo que muestra la tarjeta; uno igual al actual es lo precargado que nadie
//   tocó, y contarlo como `manual` lo fijaría para siempre a nombre de quien pega y dejaría el link en `manual`.

/** Título y empresa que la persona escribió aparte, en el diálogo de pegado. */
export interface PastedHeader {
  readonly title?: string;
  readonly company?: string;
}

/** Lo que se sacó de un texto pegado: lo que leyó la IA y lo que la persona escribió aparte. */
export interface PastedContent {
  /** Campos que leyó la IA. Los que no dicen nada o no cumplen su contrato se descartan. */
  readonly extracted: Partial<JobPreview>;
  /** Título y empresa escritos aparte. Los iguales a lo que el link ya tenía se ignoran. */
  readonly header?: PastedHeader;
}

const HEADER_FIELDS = ['title', 'company'] as const;

/**
 * El título y la empresa escritos aparte que de verdad cambian algo: sin los que coinciden con lo que el link ya
 * tenía. Es lo que se escribe a mano y también lo que se le da a la IA como contexto; uno ignorado es, a todos los
 * efectos, uno que no se escribió.
 */
export function effectiveHeader(
  stored: StoredPreview | undefined,
  header: PastedHeader | undefined,
): PastedHeader {
  const effective: { title?: string; company?: string } = {};
  for (const field of HEADER_FIELDS) {
    const value = header?.[field];
    if (value !== undefined && !sameValue(stored?.[field], value)) {
      effective[field] = value;
    }
  }
  return effective;
}

/** Preview con lo pegado aplicado. `changed` es `false` si lo pegado no cambia ningún campo. */
export function applyPastedPreview(
  stored: EditablePreview,
  pasted: PastedContent,
  by: string,
  now: Date,
): EditedPreview {
  const draft = mutableCopyOf(stored);
  const at = now.toISOString();
  const header = effectiveHeader(stored.preview, pasted.header);
  let changed = false;

  for (const field of HEADER_FIELDS) {
    const value = header[field];
    if (value !== undefined) {
      writeByHand(draft, field, value, by, at);
      changed = true;
    }
  }

  const extracted = draftFrom(PASTED_PREVIEW_EXTRACTOR, pasted.extracted);
  for (const field of PREVIEW_FIELD_NAMES) {
    const proposal = extracted[field];
    // Lo escrito aparte es de rango superior a lo que la IA leyó del mismo texto.
    if (proposal === undefined || field in header) {
      continue;
    }
    const previous = draft.sources[field];
    if (!mayOverwrite(previous?.source, 'pasted')) {
      continue;
    }
    if (
      previous !== undefined &&
      sameValue(previous.value, proposal.value) &&
      sameValue(draft.preview[field], proposal.value)
    ) {
      continue;
    }
    draft.preview[field] = proposal.value;
    draft.sources[field] = {
      value: proposal.value,
      source: 'pasted',
      extractor: proposal.extractor,
      by,
      at,
      ...(previous === undefined
        ? {}
        : { replaced: displacedEntryOf(previous) }),
    };
    changed = true;
  }

  return editedFrom(draft, changed);
}

/**
 * Escribe a mano el título o la empresa del diálogo. Sigue la regla de la edición manual: guarda la entrada que
 * desplaza, y si ya estaba escrito a mano conserva lo que ese campo guardaba —la fuente—.
 */
function writeByHand(
  draft: MutablePreview,
  field: (typeof HEADER_FIELDS)[number],
  value: string,
  by: string,
  at: string,
): void {
  const previous = draft.sources[field];
  const replaced =
    previous === undefined
      ? undefined
      : previous.source === 'manual'
        ? previous.replaced
        : displacedEntryOf(previous);
  draft.preview[field] = value;
  draft.sources[field] = {
    value,
    source: 'manual',
    by,
    at,
    ...(replaced === undefined ? {} : { replaced }),
  };
}

/**
 * Estado del link tras pegar (D6): se deriva de los campos, con la misma prioridad que el worker. `manual` si alguno lo
 * escribió una persona, `enriched` si están título y empresa, y `partial` si no.
 */
export function pastedPreviewStatus(
  preview: StoredPreview,
  sources: PreviewSources,
): PreviewStatus {
  const writtenByHand = PREVIEW_FIELD_NAMES.some(
    (field) => sources[field]?.source === 'manual',
  );
  if (writtenByHand) return 'manual';
  return hasRequiredFields(preview) ? 'enriched' : 'partial';
}

/**
 * Motivos que sobreviven a un pegado (D6): los del sitio, que no se reintentan. Pegar no convierte en legible lo que el
 * sitio prohibió o bloqueó, y borrarlos volvería a ofrecer un reintento inútil. `not_a_job` tampoco se reintenta, pero
 * no sobrevive: un pegado que llega a escribirse es uno que la IA reconoció como oferta, y dice lo contrario.
 */
const REASONS_KEPT_AFTER_PASTE: readonly EnrichmentFailureReason[] = [
  'robots_disallowed',
  'blocked',
];

/**
 * El motivo de fallo que sobrevive a un pegado. Un fallo transitorio ya no describe un link que tiene sus campos, y
 * se borra.
 */
export function failureKeptAfterPaste(
  lastError: LastEnrichmentError | undefined,
): LastEnrichmentError | undefined {
  return lastError !== undefined &&
    REASONS_KEPT_AFTER_PASTE.includes(lastError.reason)
    ? lastError
    : undefined;
}
