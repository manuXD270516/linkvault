import type { OutputLanguage } from '@linkvault/shared';

export const DISCOVERY_USER_LANGUAGE = Symbol('DISCOVERY_USER_LANGUAGE');

/** Idioma de salida del perfil para `lang` de Get on Board (default `es`). */
export interface DiscoveryUserLanguage {
  getOutputLanguage(userId: string): Promise<OutputLanguage>;
}
