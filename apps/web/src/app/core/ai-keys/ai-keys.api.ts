import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AiKeyView, AiVendor, ListAiKeysResponse, UpsertAiKeyRequest } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';

const AI_KEYS_URL = '/api/users/me/ai-keys';

/**
 * Llamadas a `/api/users/me/ai-keys` (spec web/byok). El Bearer lo pone `authInterceptor`.
 * Solo importa tipos de `@linkvault/shared`; nunca recibe ni reenvía plaintext fuera del PUT.
 */
@Injectable({ providedIn: 'root' })
export class AiKeysApi {
  private readonly http = inject(HttpClient);

  /**
   * Devuelve el cuerpo **entero** del listado: `keys` (solo los vendors con clave guardada) y `vendors`
   * (la disponibilidad de los tres vendors soportados, tengan clave o no).
   *
   * Antes se devolvía solo `response.keys` y el resto del cuerpo se tiraba. La pantalla necesita `vendors`
   * para distinguir «no forzamos data_collection: deny» de «este vendor no está disponible», y la spec de
   * `web/byok` le prohíbe deducir ese estado: tiene que venir del API. Quedarse solo con `keys` obligaría a
   * reimplementar en el cliente el criterio del servidor, que es justo lo que este contrato evita.
   */
  list(): Promise<ListAiKeysResponse> {
    return firstValueFrom(this.http.get<ListAiKeysResponse>(AI_KEYS_URL));
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
