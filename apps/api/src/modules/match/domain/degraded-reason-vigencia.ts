import type { MatchDegradedReason } from '@linkvault/shared';

// Vigencia del motivo de un informe degradado (D12-quater, ADR-030 §8). Función pura: no consulta elegibilidad ni
// toca el reloj del sistema; quien llama le pasa las tres cosas y solo tres —lo guardado, el consentimiento y la
// respuesta de elegibilidad—.

/** Consentimiento efectivo de quien pide, tal y como lo interpreta `users` (activo y sobre el texto vigente). */
export type MatchConsentSnapshot = {
  readonly externalProviders: boolean;
};

/**
 * Resultado de la consulta de elegibilidad (4.3). `unavailable` no es "no hay ninguno": es que no se pudo saber, y
 * entonces el motivo se trata como **no vigente** (mejor gastar una ejecución que no sale fuera que un botón muerto).
 */
export type MatchEligibilitySnapshot =
  | { readonly status: 'ready'; readonly hasEligible: boolean }
  | { readonly status: 'unavailable' };

export type DegradedReasonVigenciaInput = {
  readonly degradedReason: MatchDegradedReason;
  readonly aiQuotaRetryAt?: Date;
  readonly consent: MatchConsentSnapshot;
  readonly eligibility: MatchEligibilitySnapshot;
  readonly now: Date;
};

/**
 * `true` si el motivo del degradado **sigue vigente** y el `POST` debe devolver ese mismo informe sin encolar.
 *
 * - Cuota de IA: vigente mientras `aiQuotaRetryAt` no haya llegado.
 * - Falta de consentimiento: vigente mientras quien pide **sigue sin** permiso externo.
 * - Sin proveedores: vigente mientras **sigue sin** haber ninguno elegible.
 * - `providers_failed`: **nunca** vigente.
 * - Elegibilidad que no se pudo consultar: **no** vigente (salvo la cuota, que no la necesita).
 */
export function isDegradedReasonCurrent(
  input: DegradedReasonVigenciaInput,
): boolean {
  const { degradedReason, aiQuotaRetryAt, consent, eligibility, now } = input;

  if (degradedReason === 'providers_failed') {
    return false;
  }

  if (degradedReason === 'quota_exceeded') {
    return (
      aiQuotaRetryAt !== undefined && now.getTime() < aiQuotaRetryAt.getTime()
    );
  }

  if (eligibility.status === 'unavailable') {
    return false;
  }

  if (degradedReason === 'consent_required') {
    return !consent.externalProviders;
  }

  // no_providers
  return !eligibility.hasEligible;
}
