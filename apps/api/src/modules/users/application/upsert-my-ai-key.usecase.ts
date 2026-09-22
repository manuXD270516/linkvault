import {
  keyHintOf,
  SECRET_VAULT,
  USER_AI_KEYS_REPOSITORY,
  type SecretVault,
  type UserAiKeysRepository,
} from '@linkvault/ai';
import type {
  AiKeyView,
  AiVendor,
  UpsertAiKeyRequest,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AiVaultUnavailable } from '../domain/errors';
import { USERS_CLOCK, type Clock } from './ports/clock.port';

/**
 * `PUT /api/users/me/ai-keys/:vendor` (spec ai/byok): cifra con el vault, upsert y responde solo la vista
 * (vendor, keyHint, updatedAt). Sin vault → `AiVaultUnavailable` (503). Nunca persiste ni devuelve plaintext.
 */
@Injectable()
export class UpsertMyAiKey {
  constructor(
    @Inject(SECRET_VAULT) private readonly vault: SecretVault,
    @Inject(USER_AI_KEYS_REPOSITORY)
    private readonly keys: UserAiKeysRepository,
    @Inject(USERS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    vendor: AiVendor,
    body: UpsertAiKeyRequest,
  ): Promise<AiKeyView> {
    if (!this.vault.isAvailable()) {
      throw new AiVaultUnavailable();
    }
    const ciphertext = await this.vault.encrypt(body.apiKey);
    const view = await this.keys.upsert({
      userId,
      vendor,
      ciphertext,
      keyHint: keyHintOf(body.apiKey),
      updatedAt: this.clock.now(),
    });
    return toAiKeyView(view);
  }
}

function toAiKeyView(view: {
  vendor: AiVendor;
  keyHint: string;
  updatedAt: Date;
}): AiKeyView {
  return {
    vendor: view.vendor,
    keyHint: view.keyHint,
    updatedAt: view.updatedAt.toISOString(),
  };
}
