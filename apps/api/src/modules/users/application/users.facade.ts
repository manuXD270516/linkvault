import type { UserProfile } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { UserNotFound } from '../domain/errors';
import { createUser, normalizeEmail } from '../domain/user';
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
  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    const updated = await this.users.setPasswordHash(
      userId,
      passwordHash,
      this.clock.now(),
    );
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
}
