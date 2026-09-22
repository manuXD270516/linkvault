import {
  AI_CONSENT_TEXT_VERSION,
  isAiConsentCurrent,
  type UserProfile,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { UserNotFound } from '../domain/errors';
import { createUser, normalizeEmail } from '../domain/user';
import type { OutputLanguage } from '../domain/user-profile';
import { USERS_CLOCK, type Clock } from './ports/clock.port';
import {
  USER_REPOSITORY,
  type UserRepository,
} from './ports/user-repository.port';
import { toUserProfile } from './user-profile.mapper';

// Única entrada de otros módulos a `users` (D1 de auth-users). `auth` la usa a través de su puerto USER_ACCOUNTS y nunca
// toca la colección. Los emails se normalizan aquí: quien llama puede pasar el valor tal cual lo recibió.

export interface UserCredentials {
  readonly userId: string;
  readonly email: string;
  readonly passwordHash: string;
}

export interface UserAuthState {
  readonly userId: string;
  /** Los access tokens emitidos antes de este instante ya no valen (D3). */
  readonly passwordChangedAt: Date;
}

/** Consentimiento de IA de un usuario, tal y como lo ve otro módulo: solo el permiso, sin el resto del perfil. */
export interface UserAiConsent {
  /** Permiso para enviar sus datos a proveedores de IA externos. */
  readonly externalProviders: boolean;
}

/**
 * Contexto de IA efectivo: el consentimiento ya cruzado con `isAiConsentCurrent`, más idioma, redacción y el nombre
 * para el `PiiRedactor`. Nadie fuera de `users` interpreta la vigencia del consentimiento.
 */
export interface UserEffectiveAiContext {
  readonly aiConsent: UserAiConsent;
  readonly outputLanguage: OutputLanguage;
  readonly redactName: boolean;
  /** Nombre visible, para redactar ante proveedores externos cuando `redactName` está activo. */
  readonly personName: string;
}

export interface CreateUserWithPassword {
  readonly email: string;
  /** Hash Argon2id ya calculado por `auth`; `users` nunca ve la contraseña. */
  readonly passwordHash: string;
  readonly displayName: string;
}

@Injectable()
export class UsersFacade {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(USERS_CLOCK) private readonly clock: Clock,
  ) {}

  async findCredentialsByEmail(email: string): Promise<UserCredentials | null> {
    const user = await this.users.findByEmail(normalizeEmail(email));
    return user
      ? { userId: user.id, email: user.email, passwordHash: user.passwordHash }
      : null;
  }

  /** Alta en una sola escritura con el perfil por defecto. Rechaza con `EmailAlreadyRegistered` si el email existe. */
  async createWithPassword(
    input: CreateUserWithPassword,
  ): Promise<UserProfile> {
    const user = await this.users.create(
      createUser({ ...input, now: this.clock.now() }),
    );
    return toUserProfile(user);
  }

  /** Sustituye el hash y fija `passwordChangedAt` al instante actual. Rechaza con `UserNotFound` si no existe. */
  async setPasswordHash(
    userId: string,
    passwordHash: string,
    session?: object,
  ): Promise<void> {
    const updated = await this.users.setPasswordHash(
      userId,
      passwordHash,
      this.clock.now(),
      session,
    );
    if (!updated) {
      throw new UserNotFound(userId);
    }
  }

  /**
   * Marca el email como verificado (ADR-034 D7). Dueño del campo: auth no escribe `users` directo.
   * `session` opaca para la txn del consumo del token.
   */
  async markEmailVerified(userId: string, session?: object): Promise<void> {
    const updated = await this.users.markEmailVerified(userId, session);
    if (!updated) {
      throw new UserNotFound(userId);
    }
  }

  /** Lo que necesita el guard por petición: existencia y `passwordChangedAt`. `null` si el usuario no existe. */
  async getAuthState(userId: string): Promise<UserAuthState | null> {
    const user = await this.users.findById(userId);
    return user
      ? { userId: user.id, passwordChangedAt: user.passwordChangedAt }
      : null;
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    const user = await this.users.findById(userId);
    return user ? toUserProfile(user) : null;
  }

  /**
   * Consentimiento de IA de un usuario (D2 de paste-job-description): `links` lo necesita para leer lo que pega, que es
   * un dato personal suyo, y no puede leer el perfil entero ni el dominio de `users` (ADR-020 §6). Un usuario que no
   * existe no ha consentido nada: responde sin permiso, que es el valor seguro. La vigencia se interpreta aquí —activo
   * y sobre el texto actual— para que nadie fuera de `users` mienta tras un cambio de texto (D4).
   */
  async aiConsentOf(userId: string): Promise<UserAiConsent> {
    const context = await this.effectiveAiContextOf(userId);
    return { externalProviders: context.aiConsent.externalProviders };
  }

  /**
   * Contexto de IA efectivo de una persona: consentimiento ya cruzado con `isAiConsentCurrent`, idioma, `redactName` y
   * el nombre para la redacción. Un usuario inexistente responde sin permiso y con los valores seguros de fábrica.
   */
  async effectiveAiContextOf(userId: string): Promise<UserEffectiveAiContext> {
    const user = await this.users.findById(userId);
    if (!user) {
      return {
        aiConsent: { externalProviders: false },
        outputLanguage: 'es',
        redactName: true,
        personName: '',
      };
    }
    return {
      aiConsent: {
        externalProviders: isAiConsentCurrent({
          externalProviders: user.profile.aiConsent.externalProviders,
          textVersion: user.profile.aiConsent.textVersion,
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        }),
      },
      outputLanguage: user.profile.outputLanguage,
      redactName: user.profile.redactName,
      personName: user.profile.displayName,
    };
  }

  /**
   * Nombre visible de cada id conocido, en una sola consulta (D7 de groups): es lo único que otro módulo puede saber de
   * un usuario ajeno. Un id desconocido no aparece en el mapa; el email nunca sale de `users`.
   */
  getDisplayNames(userIds: readonly string[]): Promise<Map<string, string>> {
    return this.users.findDisplayNames(userIds);
  }
}
