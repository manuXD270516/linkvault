import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import type { WeeklyPlanAction, WeeklyPlanDecision, WeeklyPlanResponse } from '@linkvault/shared';
import { WeeklyPlanApi } from './weekly-plan.api';

/**
 * Plan semanal «Tu semana» (design D10). Store propio e independiente del de postulaciones: un fallo del plan no
 * bloquea el tablero. Es `root` porque `ApplicationMoves` lo recarga tras cada cambio de estado que termina bien.
 */
export interface WeeklyPlanState {
  /** `loading` solo hasta la primera respuesta: una recarga con plan a la vista no lo parpadea. */
  status: 'loading' | 'ready' | 'error';
  plan: WeeklyPlanResponse | null;
  /** `candidateId` de la acción cuya decisión viaja; solo esa deshabilita sus botones. */
  decidingId: string | null;
  /** La última decisión falló por algo distinto de «la acción ya no aplica». */
  saveFailed: boolean;
  /** `applicationId` de la acción `apply_before_close` marcada «Hecho»: ofrece «¿Ya postulaste?» (B5). */
  justAppliedId: string | null;
}

const initialState: WeeklyPlanState = {
  status: 'loading',
  plan: null,
  decidingId: null,
  saveFailed: false,
  justAppliedId: null,
};

export const WeeklyPlanStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store, api = inject(WeeklyPlanApi)) => {
    // Solo vale la última petición de lectura: una recarga lenta no pisa a una más nueva.
    let loadSeq = 0;

    async function load(): Promise<void> {
      const seq = ++loadSeq;
      if (store.plan() === null) {
        patchState(store, { status: 'loading' });
      }
      try {
        const plan = await api.get();
        if (seq === loadSeq) {
          patchState(store, { plan, status: 'ready' });
        }
      } catch {
        // Con un plan ya a la vista, un fallo al recargar lo deja como está; sin plan, muestra el error.
        if (seq === loadSeq && store.plan() === null) {
          patchState(store, { status: 'error' });
        }
      }
    }

    async function decide(action: WeeklyPlanAction, decision: WeeklyPlanDecision): Promise<void> {
      patchState(store, { decidingId: action.candidateId, saveFailed: false, justAppliedId: null });
      try {
        const plan = await api.decide({ candidateId: action.candidateId, decision });
        loadSeq++;
        patchState(store, {
          plan,
          status: 'ready',
          justAppliedId:
            decision === 'done' && action.rule === 'apply_before_close' ? action.applicationId : null,
        });
      } catch (error: unknown) {
        if (isActionGone(error)) {
          // La acción ya no aplica: se pide el plan de nuevo, sin mensaje de error.
          await load();
        } else {
          patchState(store, { saveFailed: true });
        }
      } finally {
        patchState(store, { decidingId: null });
      }
    }

    return { load, decide };
  }),
);

/**
 * `404 weekly_plan_action_not_found`: la acción ya no aplica. Compara el `code` como texto para no depender de que el
 * catálogo de `ApiErrorCode` ya lo traiga.
 */
function isActionGone(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== 404) {
    return false;
  }
  const body: unknown = error.error;
  return typeof body === 'object' && body !== null && 'code' in body && body.code === 'weekly_plan_action_not_found';
}

export type WeeklyPlanStore = InstanceType<typeof WeeklyPlanStore>;
