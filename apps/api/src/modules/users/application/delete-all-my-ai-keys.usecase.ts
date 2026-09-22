import {
  USER_AI_KEYS_REPOSITORY,
  type UserAiKeysRepository,
} from '@linkvault/ai';
import { Inject, Injectable } from '@nestjs/common';

/**
 * `DELETE /api/users/me/ai-keys` (colección): borra todas las claves BYOK de quien pide.
 */
@Injectable()
export class DeleteAllMyAiKeys {
  constructor(
    @Inject(USER_AI_KEYS_REPOSITORY)
    private readonly keys: UserAiKeysRepository,
  ) {}

  async execute(userId: string): Promise<void> {
    await this.keys.deleteAllKeysForUser(userId);
  }
}
