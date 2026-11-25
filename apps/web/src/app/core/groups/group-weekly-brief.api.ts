import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { type GroupWeeklyBriefResponse, groupWeeklyBriefResponseSchema } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';

/**
 * Lectura de «La semana del grupo» (design D9, spec web/group-weekly-brief). El `Bearer` lo pone `authInterceptor`.
 * Valida la respuesta con el schema de `libs/shared`: una respuesta que no cumple el contrato rechaza la promesa y la
 * tarjeta muestra su error, nunca datos a medias. Solo la importa la tarjeta (chunk lazy de grupos), así zod no entra en
 * el bundle inicial.
 */
@Injectable({ providedIn: 'root' })
export class GroupWeeklyBriefApi {
  private readonly http = inject(HttpClient);

  async get(groupId: string): Promise<GroupWeeklyBriefResponse> {
    const body = await firstValueFrom(
      this.http.get<unknown>(`/api/groups/${encodeURIComponent(groupId)}/weekly-brief`),
    );
    return groupWeeklyBriefResponseSchema.parse(body);
  }
}
