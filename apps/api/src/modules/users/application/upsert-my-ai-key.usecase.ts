import {
  BYOK_VENDOR_AVAILABILITY,
  keyHintOf,
  SECRET_VAULT,
  USER_AI_KEYS_REPOSITORY,
  type ByokVendorAvailability,
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
 * (vendor, keyHint, updatedAt, available). Sin vault → `AiVaultUnavailable` (503). Nunca persiste ni devuelve
 * plaintext.
 *
 * La respuesta del PUT es **una vista suelta**, no el listado, así que sin poblar aquí `available` la pantalla se
 * quedaría con el estado viejo justo después de guardar una clave y no tendría de dónde leerlo (10-bis.4). El
 * estado sale del mismo `BYOK_VENDOR_AVAILABILITY` que usa el listado: no se decide en este caso de uso.
 */
@Injectable()
export class UpsertMyAiKey {
  constructor(
    @Inject(SECRET_VAULT) private readonly vault: SecretVault,
    @Inject(USER_AI_KEYS_REPOSITORY)
    private readonly keys: UserAiKeysRepository,
    @Inject(USERS_CLOCK) private readonly clock: Clock,
    @Inject(BYOK_VENDOR_AVAILABILITY)
    private readonly availability: ByokVendorAvailability,
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
    return toAiKeyView(view, this.availability(view.vendor));
  }
}

function toAiKeyView(
  view: {
    vendor: AiVendor;
    keyHint: string;
    updatedAt: Date;
  },
  available: boolean,
): AiKeyView {
  return {
    vendor: view.vendor,
    keyHint: view.keyHint,
    updatedAt: view.updatedAt.toISOString(),
    available,
  };
}
