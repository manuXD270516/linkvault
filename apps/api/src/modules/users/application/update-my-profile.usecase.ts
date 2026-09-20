import { AI_CONSENT_TEXT_VERSION, type UserProfile } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import {
  ConsentTextOutdated,
  InvalidProfileChanges,
  UserNotFound,
} from '../domain/errors';
import { normalizeProfileChanges } from '../domain/user';
import type {
  AiConsent,
  AiConsentChange,
  ProfileChanges,
  ProfileUpdateInput,
} from '../domain/user-profile';
import { USERS_CLOCK, type Clock } from './ports/clock.port';
import {
  USER_REPOSITORY,
  type UserRepository,
} from './ports/user-repository.port';
import { toUserProfile } from './user-profile.mapper';

/**
 * `PATCH /api/users/me` (spec users/profile): aplica solo los campos enviados y devuelve el perfil completo. Los cambios
 * se validan antes de escribir, así que un cambio inválido no modifica nada. Al activar el consentimiento exige la
 * versión vigente y estampa `consentedAt`; al revocar deja fecha y versión en `null` sin tocar CVs ni análisis (D5).
 */
@Injectable()
export class UpdateMyProfile {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(USERS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    changes: ProfileUpdateInput,
  ): Promise<UserProfile> {
    const updated = await this.users.updateProfile(
      userId,
      normalizeProfileChanges(prepareProfileChanges(changes, this.clock.now())),
    );
    if (!updated) {
      throw new UserNotFound(userId);
    }
    return toUserProfile(updated);
  }
}

/**
 * Convierte el cuerpo del `PATCH` en cambios listos para persistir: estampa o anula el consentimiento. Lanza
 * `ConsentTextOutdated` sin tocar el perfil si la versión no es la vigente.
 */
export function prepareProfileChanges(
  changes: ProfileUpdateInput,
  now: Date,
): ProfileChanges {
  const prepared: {
    -readonly [K in keyof ProfileChanges]: ProfileChanges[K];
  } = {};
  if (changes.displayName !== undefined) {
    prepared.displayName = changes.displayName;
  }
  if (changes.outputLanguage !== undefined) {
    prepared.outputLanguage = changes.outputLanguage;
  }
  if (changes.redactName !== undefined) {
    prepared.redactName = changes.redactName;
  }
  if (changes.aiConsent !== undefined) {
    prepared.aiConsent = resolveAiConsent(changes.aiConsent, now);
  }
  return prepared;
}

function resolveAiConsent(change: AiConsentChange, now: Date): AiConsent {
  if (change.externalProviders !== true) {
    return {
      externalProviders: false,
      consentedAt: null,
      textVersion: null,
    };
  }
  // Defensa en profundidad: el pipe zod ya responde 400 nombrando el campo.
  if (change.textVersion === undefined || change.textVersion.length < 1) {
    throw new InvalidProfileChanges('textVersion');
  }
  if (change.textVersion !== AI_CONSENT_TEXT_VERSION) {
    throw new ConsentTextOutdated();
  }
  return {
    externalProviders: true,
    consentedAt: now,
    textVersion: change.textVersion,
  };
}
