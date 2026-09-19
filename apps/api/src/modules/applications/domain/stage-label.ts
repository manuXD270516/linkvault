import { InvalidStageLabel } from './errors';
import { STAGE_STATUS, type ApplicationStatus } from './application-status';

// Etapa libre de "En proceso" (ADR-004, D2): de 1 a 60 caracteres tras quitar los espacios exteriores. El contrato HTTP
// ya lo valida; el dominio lo reaplica para que ninguna otra entrada deje una etapa inválida o fuera de `in_process`.

export const STAGE_LABEL_MAX_LENGTH = 60;

/**
 * Etapa pedida: texto, `null` (sin etapa) o `undefined` (omitida). Omitida y `null` no son lo mismo: estando en
 * `in_process` y pidiendo `in_process`, omitirla la conserva y `null` la borra.
 */
export type RequestedStageLabel = string | null | undefined;

/** Etapa sin espacios exteriores, o `InvalidStageLabel` si queda vacía o pasa del máximo. */
export function normalizeStageLabel(raw: string): string {
  const label = raw.trim();
  if (label.length === 0 || label.length > STAGE_LABEL_MAX_LENGTH) {
    throw new InvalidStageLabel();
  }
  return label;
}

/**
 * Etapa resultante de ir a `to` desde un estado con `current` de etapa (D2):
 * - Con texto, solo con `in_process`; con cualquier otro estado, `InvalidStageLabel`.
 * - `null` significa "sin etapa" con cualquier estado.
 * - Omitida, conserva la etapa solo si ya estaba en `in_process` y sigue en `in_process`; entrar en `in_process` desde
 *   otro estado sin etapa la deja vacía.
 * - Fuera de `in_process` nunca hay etapa: salir la borra (el evento de salida la conserva como etapa de origen).
 */
export function resolveStageLabel(params: {
  readonly from?: ApplicationStatus;
  readonly current?: string;
  readonly to: ApplicationStatus;
  readonly requested: RequestedStageLabel;
}): string | undefined {
  const { from, current, to, requested } = params;
  if (typeof requested === 'string') {
    const label = normalizeStageLabel(requested);
    if (to !== STAGE_STATUS) {
      throw new InvalidStageLabel();
    }
    return label;
  }
  if (to !== STAGE_STATUS || requested === null) {
    return undefined;
  }
  return from === STAGE_STATUS ? current : undefined;
}
