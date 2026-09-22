import {
  USER_AI_KEYS_REPOSITORY,
  type UserAiKeysRepository,
} from '@linkvault/ai';
import type { AiVendor } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';

/**
 * `DELETE /api/users/me/ai-keys/:vendor` (spec ai/byok): borra la fila de ese vendor. Idempotente (204 aunque no exista).
 */
@Injectable()
export class DeleteMyAiKey {
  constructor(
    @Inject(USER_AI_KEYS_REPOSITORY)
    private readonly keys: UserAiKeysRepository,
  ) {}

  async execute(userId: string, vendor: AiVendor): Promise<void> {
    await this.keys.delete(userId, vendor);
  }
}
