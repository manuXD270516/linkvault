import type { DegradedReason, ProviderCondition } from './ai-result';
import type { ProviderFailureKind } from './errors';

// Agregación de la condición del proveedor (D4 de paste-fallback-honest, ADR-060 §4). Función pura, sin E/S.

/** Clase con que cuenta un proveedor afectado: la de su fallo o la falta de permiso. */
export type AffectedKind = ProviderFailureKind | 'consent_missing';

const FAILURE_PRECEDENCE: readonly ProviderFailureKind[] = [
  'unavailable',
  'rate_limited',
  'rejected',
];

/** Clase dominante de un conjunto de fallos: `unavailable` > `rate_limited` > `rejected`. Vacío: `unavailable`. */
export function dominantFailureKind(
  kinds: readonly ProviderFailureKind[],
): ProviderFailureKind {
  for (const kind of FAILURE_PRECEDENCE) {
    if (kinds.includes(kind)) return kind;
  }
  return 'unavailable';
}

/**
 * Condición del degradado. Solo existe con `providers_failed` y `no_providers`. Con `no_providers` gana
 * `consent_missing`; con `providers_failed` esos afectados no cuentan (hubo una avería). Después, la precedencia
 * `unavailable` > `rate_limited` > `rejected`. Sin afectados, no hay condición.
 */
export function aggregateProviderCondition(
  reason: DegradedReason,
  affected: readonly AffectedKind[],
): ProviderCondition | undefined {
  if (reason !== 'no_providers' && reason !== 'providers_failed') {
    return undefined;
  }
  if (reason === 'no_providers' && affected.includes('consent_missing')) {
    return { kind: 'consent_missing' };
  }
  const failures = affected.filter(
    (kind): kind is ProviderFailureKind => kind !== 'consent_missing',
  );
  if (failures.length === 0) return undefined;
  return { kind: dominantFailureKind(failures) };
}
