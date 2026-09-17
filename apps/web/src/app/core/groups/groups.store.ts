import { computed, inject } from '@angular/core';
import type { GroupDetail, GroupSummary } from '@linkvault/shared';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { type RequestFailure, toRequestFailure } from '../api/api-error';
import { GroupsApi } from './groups.api';

/**
 * Lista de grupos del usuario (D10). `loaded` distingue "todavía no se ha pedido" de "no tiene grupos", que es lo que
 * decide el estado vacío de `/grupos`.
 */
export interface GroupsState {
  groups: GroupSummary[];
  loading: boolean;
  loaded: boolean;
  /** Fallo de la última carga de la lista; las acciones propagan su error al llamante, que lo traduce por código. */
  failure: RequestFailure | null;
}

const initialState: GroupsState = {
  groups: [],
  loading: false,
  loaded: false,
  failure: null,
};

export const GroupsStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ groups, loaded }) => ({
    isEmpty: computed(() => loaded() && groups().length === 0),
  })),
  withMethods((store, api = inject(GroupsApi)) => {
    /** Recarga la lista; nunca rechaza, para que un fallo de la recarga no se confunda con el de la acción. */
    const load = async (): Promise<void> => {
      patchState(store, { loading: true, failure: null });
      try {
        patchState(store, { groups: await api.listGroups(), loaded: true });
      } catch (error: unknown) {
        patchState(store, { failure: toRequestFailure(error) });
      } finally {
        patchState(store, { loading: false });
      }
    };

    return {
      load,

      /** Crea el grupo y recarga la lista; el error viaja al diálogo, que lo traduce por código. */
      async create(name: string): Promise<GroupDetail> {
        const group = await api.createGroup(name);
        await load();
        return group;
      },

      /** Se une con el código (normalizado en `GroupsApi`) y recarga la lista. */
      async join(code: string): Promise<GroupSummary> {
        const group = await api.joinGroup(code);
        await load();
        return group;
      },

      async leave(groupId: string): Promise<void> {
        await api.leaveGroup(groupId);
        await load();
      },

      async remove(groupId: string): Promise<void> {
        await api.deleteGroup(groupId);
        await load();
      },

      /** Expulsa a un miembro; la lista se recarga porque cambia el número de miembros del grupo. */
      async removeMember(groupId: string, userId: string): Promise<void> {
        await api.removeMember(groupId, userId);
        await load();
      },

      /** Olvida un grupo al que el usuario ya no pertenece (404 del detalle), sin pedir la lista otra vez. */
      forget(groupId: string): void {
        patchState(store, { groups: store.groups().filter((group) => group.id !== groupId) });
      },
    };
  }),
);

export type GroupsStore = InstanceType<typeof GroupsStore>;
