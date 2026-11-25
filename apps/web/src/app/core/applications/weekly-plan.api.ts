import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { WeeklyPlanDecisionRequest, WeeklyPlanResponse } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';

const WEEKLY_PLAN_URL = '/api/applications/weekly-plan';

/** Llamadas del plan semanal (design D8). El `Bearer` lo pone `authInterceptor`. Solo importa tipos de `@linkvault/shared`. */
@Injectable({ providedIn: 'root' })
export class WeeklyPlanApi {
  private readonly http = inject(HttpClient);

  get(): Promise<WeeklyPlanResponse> {
    return firstValueFrom(this.http.get<WeeklyPlanResponse>(WEEKLY_PLAN_URL));
  }

  /** Registra la decisión y devuelve el plan ya recalculado. */
  decide(body: WeeklyPlanDecisionRequest): Promise<WeeklyPlanResponse> {
    return firstValueFrom(this.http.post<WeeklyPlanResponse>(`${WEEKLY_PLAN_URL}/decisions`, body));
  }
}
