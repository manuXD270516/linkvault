// Reglas del turno por host (D6 de link-enrichment), puras y sin Redis: cuánto hay que esperar entre dos peticiones al
// mismo sitio y qué hacer cuando el host está ocupado. El mutex es infraestructura; esto es la política.

export interface HostTurnRules {
  /** `ENRICH_DOMAIN_DELAY_MS`: nuestra cortesía mínima. */
  readonly domainDelayMs: number;
  /** `ENRICH_MAX_DEFERRALS`: veces que un job puede volver a aplazarse antes de rendirse. */
  readonly maxDeferrals: number;
}

/**
 * Espera efectiva entre dos peticiones al mismo host: la mayor entre la configurada y el `Crawl-delay` que pide el
 * sitio. El sitio puede pedir más, nunca menos; si pide menos, sigue mandando nuestra cortesía.
 */
export function effectiveWaitMs(
  rules: HostTurnRules,
  crawlDelayMs: number,
): number {
  return Math.max(rules.domainDelayMs, crawlDelayMs);
}

/**
 * Qué hacer con un job que encontró su host ocupado. Aplazar no cuesta nada —un job `delayed` no ocupa ningún hueco
 * del `Worker`—, así que el tope es holgado y solo existe para que un host que nunca se libera no rebote para siempre.
 */
export type BusyHostDecision =
  | {
      readonly kind: 'defer';
      readonly deferrals: number;
      readonly waitMs: number;
    }
  | { readonly kind: 'give_up'; readonly reason: 'host_busy' };

/**
 * `deferrals` son los aplazamientos que este job ya lleva. Al agotarlos el motivo es `host_busy`, **nunca** `blocked`:
 * el sitio no ha dicho nada, el que no llegó a tiempo fue nuestro turno, así que es transitorio y reintentable.
 */
export function onBusyHost(
  rules: HostTurnRules,
  deferrals: number,
  crawlDelayMs: number,
): BusyHostDecision {
  if (deferrals >= rules.maxDeferrals) {
    return { kind: 'give_up', reason: 'host_busy' };
  }
  return {
    kind: 'defer',
    deferrals: deferrals + 1,
    waitMs: effectiveWaitMs(rules, crawlDelayMs),
  };
}
