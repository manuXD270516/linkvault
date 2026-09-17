import type { UserProfile } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { UserNotFound } from '../domain/errors';
import {
  USER_REPOSITORY,
  type UserRepository,
} from './ports/user-repository.port';
import { toUserProfile } from './user-profile.mapper';

/** `GET /api/users/me` (spec users/profile): perfil del usuario del access token. */
@Injectable()
export class GetMyProfile {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async execute(userId: string): Promise<UserProfile> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UserNotFound(userId);
    }
    return toUserProfile(user);
  }
}
