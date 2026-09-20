import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { PublicPreviewResponse } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';
import { SKIP_BEARER } from '../auth/auth.api';

const PUBLIC_PREVIEWS_URL = '/api/public/previews';

/**
 * Lectura del preview público de una oferta (`GET /api/public/previews/:slug`, D12 de public-preview-share).
 *
 * Marca `SKIP_BEARER` a propósito: es la única petición del SPA que se hace sin sesión y no debe pasar por el camino de
 * renovación de `authInterceptor`. Sin la marca, un `401` dispararía un refresh y una navegación a `/login`, y quien
 * llega desde un chat —sin cookie de refresh— pagaría una petición inútil antes de ver la oferta.
 */
@Injectable({ providedIn: 'root' })
export class PublicPreviewApi {
  private readonly http = inject(HttpClient);

  preview(slug: string): Promise<PublicPreviewResponse> {
    return firstValueFrom(
      this.http.get<PublicPreviewResponse>(`${PUBLIC_PREVIEWS_URL}/${encodeURIComponent(slug)}`, {
        context: new HttpContext().set(SKIP_BEARER, true),
      }),
    );
  }
}
