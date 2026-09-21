// Consentimiento efectivo de IA para decidir vigencia de un degradado (9.6). El adaptador de producción va sobre
// `UsersFacade.effectiveAiContextOf`; `match` no interpreta la vigencia del texto de consentimiento (eso vive en
// `users`).

export const MATCH_AI_CONSENT = Symbol('MATCH_AI_CONSENT');

export interface MatchAiConsent {
  /**
   * `true` si esa persona tiene permiso externo vigente ahora. Un usuario inexistente responde `false` (valor seguro).
   */
  externalProvidersOf(userId: string): Promise<boolean>;
}
