import { describe, expect, it } from 'vitest';
import { effectiveWaitMs, onBusyHost, type HostTurnRules } from './host-turn';

// Requisito "Cortesía con los sitios" (specs/links/enrichment) y D6 de link-enrichment: la política del turno, sin
// Redis ni reloj. El mutex que la ejecuta se prueba aparte.

const RULES: HostTurnRules = { domainDelayMs: 2_000, maxDeferrals: 600 };

describe('El sitio pide más espera de la configurada', () => {
  it('waits what the site asks when it asks for more', () => {
    expect(effectiveWaitMs(RULES, 10_000)).toBe(10_000);
  });

  it('keeps our courtesy when the site asks for less', () => {
    expect(effectiveWaitMs(RULES, 500)).toBe(2_000);
  });

  it('keeps our courtesy when the site asks for nothing', () => {
    expect(effectiveWaitMs(RULES, 0)).toBe(2_000);
  });

  it('defers a busy host for the effective wait, not for the configured one', () => {
    expect(onBusyHost(RULES, 0, 10_000)).toEqual({
      kind: 'defer',
      deferrals: 1,
      waitMs: 10_000,
    });
  });
});

describe('Host que nunca se libera', () => {
  it('keeps deferring while there are deferrals left', () => {
    expect(onBusyHost(RULES, 599, 0)).toEqual({
      kind: 'defer',
      deferrals: 600,
      waitMs: 2_000,
    });
  });

  it('gives up with its own transient reason once they run out', () => {
    // `host_busy`, nunca `blocked`: el sitio no ha dicho nada, el que no llegó a tiempo fue nuestro turno.
    expect(onBusyHost(RULES, 600, 0)).toEqual({
      kind: 'give_up',
      reason: 'host_busy',
    });
    expect(onBusyHost(RULES, 900, 0)).toEqual({
      kind: 'give_up',
      reason: 'host_busy',
    });
  });

  it('never gives up before the configured limit, however loose it is', () => {
    const decisions = Array.from({ length: RULES.maxDeferrals }, (_, n) =>
      onBusyHost(RULES, n, 0),
    );

    expect(decisions.every(({ kind }) => kind === 'defer')).toBe(true);
    expect(decisions.at(-1)).toEqual({
      kind: 'defer',
      deferrals: 600,
      waitMs: 2_000,
    });
  });
});
