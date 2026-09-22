import { computed, inject } from '@angular/core';
import type { SearchDocType, SearchHit, SearchResponse } from '@linkvault/shared';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { type RequestFailure, toRequestFailure } from '../api/api-error';
import { SearchApi } from './search.api';

/**
 * Estado de `/buscar` (spec web/search). `searched` distingue "aún no se ha buscado" de "0 hits".
 * Lo provee la página (no `root`): al salir se destruye.
 */
export interface SearchState {
  query: string;
  docType: SearchDocType | null;
  groupId: string | null;
  hits: SearchHit[];
  degraded: boolean;
  degradeReason: SearchResponse['degradeReason'] | null;
  estimatedTotal: number | null;
  loading: boolean;
  /** `true` tras al menos una búsqueda enviada con éxito o con fallo. */
  searched: boolean;
  failure: RequestFailure | null;
}

const initialState: SearchState = {
  query: '',
  docType: null,
  groupId: null,
  hits: [],
  degraded: false,
  degradeReason: null,
  estimatedTotal: null,
  loading: false,
  searched: false,
  failure: null,
};

export const SearchStore = signalStore(
  withState(initialState),
  withComputed(({ hits, searched, loading, failure }) => ({
    isEmpty: computed(() => searched() && !loading() && failure() === null && hits().length === 0),
  })),
  withMethods((store, api = inject(SearchApi)) => ({
    setDocType(docType: SearchDocType | null): void {
      patchState(store, { docType });
    },

    setGroupId(groupId: string | null): void {
      patchState(store, { groupId });
    },

    /**
     * Lanza la búsqueda. `q` vacío o solo espacios no llama a la API (alineado a `400 empty_query`);
     * el llamante muestra el aviso de consulta vacía.
     */
    async run(q: string): Promise<void> {
      const trimmed = q.trim();
      if (trimmed.length === 0) {
        return;
      }
      patchState(store, {
        query: trimmed,
        loading: true,
        failure: null,
        degraded: false,
        degradeReason: null,
      });
      try {
        const docType = store.docType();
        const groupId = store.groupId();
        const response = await api.search({
          q: trimmed,
          ...(docType !== null ? { docType } : {}),
          ...(groupId !== null ? { groupId } : {}),
        });
        patchState(store, {
          hits: response.hits,
          degraded: response.degraded === true,
          degradeReason: response.degradeReason ?? null,
          estimatedTotal: response.estimatedTotal ?? null,
          searched: true,
        });
      } catch (error: unknown) {
        patchState(store, {
          failure: toRequestFailure(error),
          hits: [],
          degraded: false,
          degradeReason: null,
          estimatedTotal: null,
          searched: true,
        });
      } finally {
        patchState(store, { loading: false });
      }
    },
  })),
);

export type SearchStore = InstanceType<typeof SearchStore>;
