import {
  BYOK_VENDOR_AVAILABILITY,
  USER_AI_KEYS_REPOSITORY,
  type ByokVendorAvailability,
  type UserAiKeysRepository,
} from '@linkvault/ai';
import {
  AI_VENDORS,
  type AiKeyView,
  type AiVendor,
  type AiVendorAvailability,
  type ListAiKeysResponse,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';

/**
 * `GET /api/users/me/ai-keys` (spec ai/byok): lista solo vistas (vendor, keyHint, updatedAt, available) de las
 * claves guardadas, más el estado de los tres vendors soportados. Sin vault responde `keys: []` (D4) — la
 * disponibilidad sigue siendo la misma, porque es un hecho sobre la configuración de la instancia y no sobre las
 * claves de nadie. Nunca ciphertext ni plaintext.
 *
 * ESTE CASO DE USO NO DECIDE NADA (10-bis.4, ADR-048 §6-ter): quién es construible lo dice `libs/ai` por el token
 * `BYOK_VENDOR_AVAILABILITY`, el mismo predicado que la factory consulta para no construir el proveedor. Repetir
 * aquí la condición sería la segunda verdad que este change persigue.
 */
@Injectable()
export class ListMyAiKeys {
  constructor(
    @Inject(USER_AI_KEYS_REPOSITORY)
    private readonly keys: UserAiKeysRepository,
    @Inject(BYOK_VENDOR_AVAILABILITY)
    private readonly availability: ByokVendorAvailability,
  ) {}

  async execute(userId: string): Promise<ListAiKeysResponse> {
    const rows = await this.keys.listByUser(userId);

    // UN SOLO MAPA para las dos salidas: el `available` de cada vista y el array `vendors` se leen de aquí, así que
    // no pueden contradecirse dentro del mismo cuerpo. El literal es explícito a propósito: `Record<AiVendor, …>`
    // hace que añadir un vendor a `AI_VENDORS` rompa el typecheck aquí en vez de devolver un estado inventado.
    const available: Record<AiVendor, boolean> = {
      anthropic: this.availability('anthropic'),
      openai: this.availability('openai'),
      openrouter: this.availability('openrouter'),
    };

    return {
      keys: rows.map(
        (row): AiKeyView => ({
          vendor: row.vendor,
          keyHint: row.keyHint,
          updatedAt: row.updatedAt.toISOString(),
          available: available[row.vendor],
        }),
      ),
      vendors: AI_VENDORS.map(
        (vendor): AiVendorAvailability => ({
          vendor,
          available: available[vendor],
        }),
      ),
    };
  }
}
