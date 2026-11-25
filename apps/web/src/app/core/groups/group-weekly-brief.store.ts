import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import type { GroupWeeklyBriefResponse } from '@linkvault/shared';
import { GroupWeeklyBriefApi } from './group-weekly-brief.api';

/**
 * Store de la tarjeta «La semana del grupo» (design D9). Propio e independiente del de grupos: un fallo de la tarjeta no
 * bloquea el detalle ni el listado. Solo lee; nada de la tarjeta escribe en la api.
 */
export interface GroupWeeklyBriefState {
  status: 'loading' | 'ready' | 'error';
  groupId: string | null;
  response: GroupWeeklyBriefResponse | null;
}

const initialState: GroupWeeklyBriefState = { status: 'loading', groupId: null, response: null };

export const GroupWeeklyBriefStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store, api = inject(GroupWeeklyBriefApi)) => {
    // Solo vale la última petición: cambiar de grupo o reintentar no deja que una respuesta vieja pise a la nueva.
    let loadSeq = 0;

    async function load(groupId: string): Promise<void> {
      const seq = ++loadSeq;
      patchState(store, { status: 'loading', groupId, response: null });
      try {
        const response = await api.get(groupId);
        if (seq === loadSeq) {
          patchState(store, { status: 'ready', response });
        }
      } catch {
        if (seq === loadSeq) {
          patchState(store, { status: 'error' });
        }
      }
    }

    async function retry(): Promise<void> {
      const groupId = store.groupId();
      if (groupId !== null) {
        await load(groupId);
      }
    }

    return { load, retry };
  }),
);

export type GroupWeeklyBriefStore = InstanceType<typeof GroupWeeklyBriefStore>;
