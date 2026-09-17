import type { UserProfile } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { UserNotFound } from '../domain/errors';
import { normalizeProfileChanges } from '../domain/user';
import type { ProfileChanges } from '../domain/user-profile';
import {
  USER_REPOSITORY,
  type UserRepository,
} from './ports/user-repository.port';
import { toUserProfile } from './user-profile.mapper';

/**
 * `PATCH /api/users/me` (spec users/profile): aplica solo los campos enviados y devuelve el perfil completo. Los cambios
 * se validan antes de escribir, así que un cambio inválido no modifica nada.
 */
@Injectable()
export class UpdateMyProfile {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async execute(userId: string, changes: ProfileChanges): Promise<UserProfile> {
    const updated = await this.users.updateProfile(
      userId,
      normalizeProfileChanges(changes),
    );
    if (!updated) {
      throw new UserNotFound(userId);
    }
    return toUserProfile(updated);
  }
}
