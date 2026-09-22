import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AiKeyView,
  AiVendor,
  ListAiKeysResponse,
  UpsertAiKeyRequest,
} from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';

const AI_KEYS_URL = '/api/users/me/ai-keys';

/**
 * Llamadas a `/api/users/me/ai-keys` (spec web/byok). El Bearer lo pone `authInterceptor`.
 * Solo importa tipos de `@linkvault/shared`; nunca recibe ni reenvía plaintext fuera del PUT.
 */
@Injectable({ providedIn: 'root' })
export class AiKeysApi {
  private readonly http = inject(HttpClient);

  /** Lista solo vistas (`vendor`, `keyHint`, `updatedAt`). */
  async list(): Promise<AiKeyView[]> {
    const response = await firstValueFrom(this.http.get<ListAiKeysResponse>(AI_KEYS_URL));
    return response.keys;
  }

  /** Guarda o rota la clave de un vendor; responde solo la vista. */
  upsert(vendor: AiVendor, body: UpsertAiKeyRequest): Promise<AiKeyView> {
    return firstValueFrom(this.http.put<AiKeyView>(vendorUrl(vendor), body));
  }

  /** Borra la fila de ese vendor (204 aunque no exista). */
  async remove(vendor: AiVendor): Promise<void> {
    await firstValueFrom(this.http.delete<null>(vendorUrl(vendor)));
  }
}

function vendorUrl(vendor: AiVendor): string {
  return `${AI_KEYS_URL}/${encodeURIComponent(vendor)}`;
}
