import {
  PREVIEW_FIELD_NAMES,
  hasAnyField,
  hasRequiredFields,
  type EnrichmentFailureReason,
  type PreviewSources,
  type PreviewStatus,
} from '@linkvault/shared';
import type { PreviewState } from './merge';

// Estados y motivos del enriquecimiento (D5 de link-enrichment), puros. Es la parte del change que decide **qué se le
// dice a la persona**, y por eso está separada de quien escribe en Mongo: se lee entera de un vistazo.

export interface PreviewVerdict {
  readonly status: PreviewStatus;
  /** `null` cuando no hay nada que contar; nunca el cuerpo de la respuesta ni la URL del usuario. */
  readonly reason: EnrichmentFailureReason | null;
}

/** Si algún campo tiene ese origen. */
function hasFieldFrom(
  sources: PreviewSources,
  source: 'pasted' | 'manual',
): boolean {
  return PREVIEW_FIELD_NAMES.some((field) => sources[field]?.source === source);
}

export interface PassResult {
  /** El preview y su procedencia tal y como quedarían tras esta pasada. */
  readonly state: PreviewState;
  /** Motivo por el que no se pudo leer la página, si no se pudo. */
  readonly failure?: EnrichmentFailureReason;
  /** Qué dijo la cadena que es la página, si alguna etapa se pronunció. */
  readonly isJobPosting?: boolean;
}

/**
 * En qué estado queda el link y con qué motivo, en este orden de precedencia:
 *
 * 1. **Lo escrito a mano manda sobre el estado.** Un link que alguien corrigió es `manual` aunque una lectura
 *    posterior falle: lo que hay dentro sigue siendo lo que esa persona escribió, y devolverlo a `failed` diría que no
 *    hay nada que ver cuando sí lo hay. El motivo del fallo se guarda igual, que es lo que ofrece el reintento.
 * 2. **Lo pegado también.** Un link completado pegando el texto de la oferta no vuelve a `failed` porque una lectura
 *    posterior de su página falle (D6 de paste-job-description): su estado se deriva de los campos que tiene, y el
 *    motivo se registra. Si no, completar una tarjeta de LinkedIn pegando y pulsar después reintentar la volvería a
 *    dejar en "no se pudo leer".
 * 3. **No se pudo leer la página**: `failed` con el motivo de la descarga.
 * 4. **Se leyó**: `enriched` con los obligatorios, `partial` con algo, y `failed` sin nada. Y ahí la distinción que
 *    da nombre a esta regla: sin campos, el motivo es `not_a_job` solo si la IA dijo que eso no era una vacante, y
 *    `no_data` en cualquier otro caso. Una lleva a "quítalo" y la otra a "reintenta o complétalo", así que confundirlas
 *    es decirle a alguien que tire un link que sí era una oferta.
 */
export function verdictOf(pass: PassResult): PreviewVerdict {
  const failure = pass.failure ?? null;

  if (hasFieldFrom(pass.state.sources, 'manual')) {
    return { status: 'manual', reason: failure };
  }

  if (failure !== null && !hasFieldFrom(pass.state.sources, 'pasted')) {
    return { status: 'failed', reason: failure };
  }

  if (hasRequiredFields(pass.state.preview)) {
    return { status: 'enriched', reason: failure };
  }
  if (hasAnyField(pass.state.preview)) {
    return { status: 'partial', reason: failure };
  }

  if (failure !== null) return { status: 'failed', reason: failure };

  return {
    status: 'failed',
    reason: pass.isJobPosting === false ? 'not_a_job' : 'no_data',
  };
}
