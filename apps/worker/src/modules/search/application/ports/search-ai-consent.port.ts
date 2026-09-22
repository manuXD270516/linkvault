/**
 * Consentimiento efectivo del dueño del agregado en indexación (C5 / ADR-036).
 */
export const SEARCH_AI_CONSENT = Symbol('SEARCH_AI_CONSENT');

export interface SearchAiConsent {
  of(userId: string): Promise<{ readonly externalProviders: boolean }>;
}
