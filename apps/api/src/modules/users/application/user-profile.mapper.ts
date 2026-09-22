import type { UserProfile } from '@linkvault/shared';
import { AI_CONSENT_TEXT_VERSION } from '@linkvault/shared';
import type { User } from '../domain/user';

/**
 * Perfil público del usuario (contrato `userProfileSchema`). Lista cerrada de campos: el hash de la contraseña y
 * `passwordChangedAt` nunca salen del módulo por esta vía.
 *
 * `currentTextVersion` es siempre la vigente del contrato compartido, aunque el usuario haya aceptado otra.
 */
export function toUserProfile(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email,
    displayName: user.profile.displayName,
    emailVerified: user.emailVerified,
    aiConsent: {
      externalProviders: user.profile.aiConsent.externalProviders,
      consentedAt: user.profile.aiConsent.consentedAt?.toISOString() ?? null,
      textVersion: user.profile.aiConsent.textVersion,
      currentTextVersion: AI_CONSENT_TEXT_VERSION,
    },
    outputLanguage: user.profile.outputLanguage,
    redactName: user.profile.redactName,
    createdAt: user.createdAt.toISOString(),
  };
}
