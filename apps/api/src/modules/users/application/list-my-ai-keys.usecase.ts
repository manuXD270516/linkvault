import {
  USER_AI_KEYS_REPOSITORY,
  type UserAiKeysRepository,
} from '@linkvault/ai';
import type { AiKeyView, ListAiKeysResponse } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';

/**
 * `GET /api/users/me/ai-keys` (spec ai/byok): lista solo vistas (vendor, keyHint, updatedAt). Sin vault
 * responde vacío (D4). Nunca ciphertext ni plaintext.
 */
@Injectable()
export class ListMyAiKeys {
  constructor(
    @Inject(USER_AI_KEYS_REPOSITORY)
    private readonly keys: UserAiKeysRepository,
  ) {}

  async execute(userId: string): Promise<ListAiKeysResponse> {
    const rows = await this.keys.listByUser(userId);
    return {
      keys: rows.map(
        (row): AiKeyView => ({
          vendor: row.vendor,
          keyHint: row.keyHint,
          updatedAt: row.updatedAt.toISOString(),
        }),
      ),
    };
  }
}
