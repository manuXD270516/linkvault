import type { UserProfile } from '@linkvault/shared';
import type { User } from '../domain/user';

/**
 * Perfil público del usuario (contrato `userProfileSchema`). Lista cerrada de campos: el hash de la contraseña y
 * `passwordChangedAt` nunca salen del módulo por esta vía.
 */
export function toUserProfile(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email,
    displayName: user.profile.displayName,
    aiConsent: { externalProviders: user.profile.aiConsent.externalProviders },
    outputLanguage: user.profile.outputLanguage,
    redactName: user.profile.redactName,
    createdAt: user.createdAt.toISOString(),
  };
}
