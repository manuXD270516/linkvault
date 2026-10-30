import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  type CapabilitiesResponse,
  capabilitiesResponseSchema,
} from '@linkvault/shared';
import { type Observable, map } from 'rxjs';

const CAPABILITIES_URL = '/api/capabilities';

/**
 * Llamada a `GET /api/capabilities` (spec platform/capabilities). Devuelve un `Observable` y no una promesa para que
 * el store pueda cancelar la petición al vencer su plazo. Valida con el schema **no estricto**: una clave nueva en la
 * API se descarta sin romper un SPA ya cargado, y un cuerpo que no valida falla.
 */
@Injectable({ providedIn: 'root' })
export class CapabilitiesApi {
  private readonly http = inject(HttpClient);

  get(): Observable<CapabilitiesResponse> {
    return this.http
      .get<unknown>(CAPABILITIES_URL)
      .pipe(map((body) => capabilitiesResponseSchema.parse(body)));
  }
}
