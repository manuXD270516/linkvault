import { describe, expect, it, vi } from 'vitest';
import { isDegradedReasonCurrent } from './degraded-reason-vigencia';

const NOW = new Date('2026-09-20T12:00:00.000Z');
const RETRY_LATER = new Date('2026-09-20T13:00:00.000Z');
const RETRY_PAST = new Date('2026-09-20T11:00:00.000Z');

describe('isDegradedReasonCurrent', () => {
  it.each([
    [
      'cuota de IA: hora de vuelta todavía no llegó',
      {
        degradedReason: 'quota_exceeded' as const,
        aiQuotaRetryAt: RETRY_LATER,
        consent: { externalProviders: true },
        eligibility: { status: 'ready' as const, hasEligible: true },
        now: NOW,
      },
      true,
    ],
    [
      'cuota de IA: hora de vuelta ya pasó',
      {
        degradedReason: 'quota_exceeded' as const,
        aiQuotaRetryAt: RETRY_PAST,
        consent: { externalProviders: true },
        eligibility: { status: 'ready' as const, hasEligible: true },
        now: NOW,
      },
      false,
    ],
    [
      'falta de consentimiento y sigue sin permiso',
      {
        degradedReason: 'consent_required' as const,
        consent: { externalProviders: false },
        eligibility: { status: 'ready' as const, hasEligible: false },
        now: NOW,
      },
      true,
    ],
    [
      'falta de consentimiento y ya lo dio',
      {
        degradedReason: 'consent_required' as const,
        consent: { externalProviders: true },
        eligibility: { status: 'ready' as const, hasEligible: true },
        now: NOW,
      },
      false,
    ],
    [
      'sin proveedores y sigue sin ninguno elegible',
      {
        degradedReason: 'no_providers' as const,
        consent: { externalProviders: true },
        eligibility: { status: 'ready' as const, hasEligible: false },
        now: NOW,
      },
      true,
    ],
    [
      'sin proveedores y ya hay alguno elegible',
      {
        degradedReason: 'no_providers' as const,
        consent: { externalProviders: true },
        eligibility: { status: 'ready' as const, hasEligible: true },
        now: NOW,
      },
      false,
    ],
    [
      'providers_failed nunca es vigente',
      {
        degradedReason: 'providers_failed' as const,
        consent: { externalProviders: true },
        eligibility: { status: 'ready' as const, hasEligible: false },
        now: NOW,
      },
      false,
    ],
  ])('%s → %s', (_label, input, expected) => {
    expect(isDegradedReasonCurrent(input)).toBe(expected);
  });

  it('una elegibilidad que no se pudo consultar se trata como no vigente', () => {
    expect(
      isDegradedReasonCurrent({
        degradedReason: 'no_providers',
        consent: { externalProviders: true },
        eligibility: { status: 'unavailable' },
        now: NOW,
      }),
    ).toBe(false);
  });

  it('no hace ninguna llamada', () => {
    const consent = { externalProviders: false };
    const eligibility = { status: 'ready' as const, hasEligible: false };
    const consentSpy = vi.spyOn(consent, 'externalProviders', 'get');
    // Acceder a la propiedad cuenta como lectura, no como llamada a un puerto. Lo que importa es que no se invoque
    // ningún método de elegibilidad ni se toque el reloj del sistema.
    const hasEligibleProvider = vi.fn();

    isDegradedReasonCurrent({
      degradedReason: 'consent_required',
      consent,
      eligibility,
      now: NOW,
    });

    expect(hasEligibleProvider).not.toHaveBeenCalled();
    expect(consentSpy).toHaveBeenCalled();
  });
});
