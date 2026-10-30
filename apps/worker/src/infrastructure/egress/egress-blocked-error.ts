import type { EgressCategory } from '@linkvault/shared/net';

/**
 * Rechazo del filtro de salida (change `enrichment-egress-guard`, design D1). Lleva la categoría y nada más: ni la
 * URL, ni el host, ni la dirección, para que ningún registro ni ningún mensaje de error los filtre.
 */
export class EgressBlockedError extends Error {
  readonly category: EgressCategory;

  constructor(category: EgressCategory) {
    super(`egress blocked: ${category}`);
    this.name = 'EgressBlockedError';
    this.category = category;
  }
}

/** Busca un `EgressBlockedError` en el error y en su cadena de `cause` (el cliente HTTP envuelve el original). */
export function findEgressBlocked(error: unknown): EgressBlockedError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    if (current instanceof EgressBlockedError) return current;
    if (!(current instanceof Error)) return null;
    current = current.cause;
  }
  return null;
}
