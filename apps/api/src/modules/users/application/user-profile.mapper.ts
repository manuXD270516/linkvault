import type { UserProfile } from '@linkvault/shared';
import { AI_CONSENT_TEXT_VERSION } from '@linkvault/shared';
import type { User } from '../domain/user';

/**
 * Perfil público del usuario (contrato `userProfileSchema`). Lista cerrada de campos: el hash de la contraseña y
 * `passwordChangedAt` nunca salen del módulo por esta vía.
 *
 * `consentedAt` / `textVersion` se rellenan en el change `cv-match-suggestions` (tarea 7.x) desde el dominio; hasta
 * entonces salen nulos. `currentTextVersion` es siempre la vigente del contrato compartido.
 */
export function toUserProfile(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email,
    displayName: user.profile.displayName,
    aiConsent: {
      externalProviders: user.profile.aiConsent.externalProviders,
      consentedAt: null,
      textVersion: null,
      currentTextVersion: AI_CONSENT_TEXT_VERSION,
    },
    outputLanguage: user.profile.outputLanguage,
    redactName: user.profile.redactName,
    createdAt: user.createdAt.toISOString(),
  };
}
