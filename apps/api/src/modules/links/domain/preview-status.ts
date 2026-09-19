import {
  PREVIEW_FIELD_NAMES,
  hasAnyField,
  hasRequiredFields,
  type LastEnrichmentError,
  type PreviewSources,
  type PreviewStatus,
  type StoredPreview,
} from '@linkvault/shared';

// Estado de un link derivado de los campos de su preview (D6 de paste-job-description). Lo usan las dos acciones de una
// persona sobre el preview —pegar la descripción y el `PATCH` que escribe a mano o vuelve atrás—, para que la tarjeta
// diga lo que de verdad queda: tras deshacer un pegado no queda nada escrito a mano, y decir `manual` sería mentir. La
// prioridad es la misma que usa el worker.

/**
 * `manual` si queda algún campo escrito a mano; si no, `enriched` con título y empresa, `partial` con algo. Si no queda
 * nada, depende de si la lectura llegó a fallar: con un motivo guardado es `failed` —y el link lo conserva, esta función
 * no lo toca—; sin motivo nadie intentó leerlo todavía, así que vuelve a `pending`. Decir `failed` ahí haría que la
 * tarjeta contara "No pudimos leer esta oferta" de una lectura que nunca ocurrió.
 */
export function previewStatusOf(
  preview: StoredPreview,
  sources: PreviewSources,
  failure: LastEnrichmentError | undefined,
): PreviewStatus {
  const writtenByHand = PREVIEW_FIELD_NAMES.some(
    (field) => sources[field]?.source === 'manual',
  );
  if (writtenByHand) return 'manual';
  if (hasRequiredFields(preview)) return 'enriched';
  if (hasAnyField(preview)) return 'partial';
  return failure === undefined ? 'pending' : 'failed';
}
