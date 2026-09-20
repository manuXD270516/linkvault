import type { OutputLanguage } from '@linkvault/shared';

// Puerto del contexto de IA efectivo (tarea 13.2 / 13.3). Consentimiento ya cruzado con `isAiConsentCurrent`.

export const AI_CONTEXT_READER = Symbol('AI_CONTEXT_READER');

export interface MatchAiContext {
  readonly aiConsent: { readonly externalProviders: boolean };
  readonly outputLanguage: OutputLanguage;
  readonly redactName: boolean;
  readonly personName: string;
}

export interface AiContextReader {
  /**
   * Contexto efectivo de esa persona. Un usuario inexistente responde sin permiso y con los valores seguros de
   * fábrica (`redactName: true`, `outputLanguage: 'es'`, nombre vacío).
   */
  read(userId: string): Promise<MatchAiContext>;
}
