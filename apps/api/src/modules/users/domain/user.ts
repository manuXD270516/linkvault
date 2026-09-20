import { InvalidDisplayName, InvalidProfileChanges } from './errors';
import {
  defaultProfile,
  OUTPUT_LANGUAGES,
  type Profile,
  type ProfileChanges,
} from './user-profile';

// Usuario (D1 de auth-users). `users` es dueño del documento completo, incluido el hash de la contraseña; `auth` lo usa
// a través del `UsersFacade` y nunca toca la colección.

/** Longitud máxima de `displayName` tras eliminar espacios exteriores (spec auth/credentials y users/profile). */
export const DISPLAY_NAME_MAX_LENGTH = 60;

export interface User {
  readonly id: string;
  /** Siempre normalizado (ver `normalizeEmail`); único entre usuarios. */
  readonly email: string;
  readonly passwordHash: string;
  /**
   * Último cambio de contraseña; al crear el usuario, su fecha de alta. Los access tokens emitidos antes de este
   * instante dejan de valer (D3).
   */
  readonly passwordChangedAt: Date;
  readonly profile: Profile;
  readonly createdAt: Date;
}

/** Usuario aún no guardado: el repositorio le asigna el id. */
export type NewUser = Omit<User, 'id'>;

/** Email normalizado: sin espacios exteriores y en minúsculas. No valida el formato (lo hace el contrato HTTP). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Nombre visible sin espacios exteriores, entre 1 y 60 caracteres (code points, el mismo criterio que zod 4). */
export function normalizeDisplayName(displayName: string): string {
  const trimmed = displayName.trim();
  const length = [...trimmed].length;
  if (length < 1 || length > DISPLAY_NAME_MAX_LENGTH) {
    throw new InvalidDisplayName();
  }
  return trimmed;
}

/** Alta de un usuario con contraseña ya hasheada y el perfil por defecto. */
export function createUser(params: {
  email: string;
  passwordHash: string;
  displayName: string;
  now: Date;
}): NewUser {
  return {
    email: normalizeEmail(params.email),
    passwordHash: params.passwordHash,
    passwordChangedAt: params.now,
    profile: defaultProfile(normalizeDisplayName(params.displayName)),
    createdAt: params.now,
  };
}

/**
 * Valida un conjunto no vacío de cambios de perfil y devuelve solo los campos enviados, con `displayName` normalizado.
 * Defensa en profundidad: el contrato HTTP ya rechaza campos desconocidos y valores inválidos. El consentimiento llega
 * ya estampado por `UpdateMyProfile` (activo con fecha/versión, o revocado con nulos).
 */
export function normalizeProfileChanges(
  changes: ProfileChanges,
): ProfileChanges {
  const normalized: {
    -readonly [K in keyof ProfileChanges]: ProfileChanges[K];
  } = {};
  if (changes.displayName !== undefined) {
    normalized.displayName = normalizeDisplayName(changes.displayName);
  }
  if (changes.aiConsent !== undefined) {
    const consent = changes.aiConsent;
    if (typeof consent.externalProviders !== 'boolean') {
      throw new InvalidProfileChanges('aiConsent');
    }
    if (consent.externalProviders) {
      if (
        typeof consent.textVersion !== 'string' ||
        consent.textVersion.length < 1
      ) {
        throw new InvalidProfileChanges('textVersion');
      }
      if (!(consent.consentedAt instanceof Date)) {
        throw new InvalidProfileChanges('aiConsent');
      }
      normalized.aiConsent = {
        externalProviders: true,
        consentedAt: consent.consentedAt,
        textVersion: consent.textVersion,
      };
    } else {
      if (consent.consentedAt !== null || consent.textVersion !== null) {
        throw new InvalidProfileChanges('aiConsent');
      }
      normalized.aiConsent = {
        externalProviders: false,
        consentedAt: null,
        textVersion: null,
      };
    }
  }
  if (changes.outputLanguage !== undefined) {
    if (!OUTPUT_LANGUAGES.includes(changes.outputLanguage)) {
      throw new InvalidProfileChanges('outputLanguage');
    }
    normalized.outputLanguage = changes.outputLanguage;
  }
  if (changes.redactName !== undefined) {
    if (typeof changes.redactName !== 'boolean') {
      throw new InvalidProfileChanges('redactName');
    }
    normalized.redactName = changes.redactName;
  }
  if (Object.keys(normalized).length === 0) {
    throw new InvalidProfileChanges();
  }
  return normalized;
}

/** Perfil resultante de aplicar solo los campos presentes en `changes`. */
export function applyProfileChanges(
  profile: Profile,
  changes: ProfileChanges,
): Profile {
  return {
    displayName: changes.displayName ?? profile.displayName,
    aiConsent: changes.aiConsent ?? profile.aiConsent,
    outputLanguage: changes.outputLanguage ?? profile.outputLanguage,
    redactName: changes.redactName ?? profile.redactName,
  };
}
