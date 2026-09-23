import { computed, inject } from '@angular/core';
import type {
  ApplicationStatus,
  JobModality,
  SearchDocType,
  SearchHit,
  SearchResponse,
} from '@linkvault/shared';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { type RequestFailure, toRequestFailure } from '../api/api-error';
import { SearchApi } from './search.api';

/** Monedas del select V0 en `/buscar` (design D2). */
export type SearchSalaryCurrency = 'BOB' | 'USD';

/**
 * Estado de `/buscar` (spec web/search). `searched` distingue "aún no se ha buscado" de "0 hits".
 * Lo provee la página (no `root`): al salir se destruye.
 */
export interface SearchState {
  query: string;
  docType: SearchDocType | null;
  groupId: string | null;
  modality: JobModality | null;
  applicationStatus: ApplicationStatus | null;
  salaryCurrency: SearchSalaryCurrency | null;
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
  modality: null,
  applicationStatus: null,
  salaryCurrency: null,
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
     * D3b: modality activa → `docType=job_preview` y limpia `applicationStatus`.
     */
    setModality(modality: JobModality | null): void {
      if (modality === null) {
        patchState(store, { modality: null });
        return;
      }
      patchState(store, {
        modality,
        docType: 'job_preview',
        applicationStatus: null,
      });
    },

    /**
     * D3b: salaryCurrency activa → `docType=job_preview` y limpia `applicationStatus`.
     */
    setSalaryCurrency(salaryCurrency: SearchSalaryCurrency | null): void {
      if (salaryCurrency === null) {
        patchState(store, { salaryCurrency: null });
        return;
      }
      patchState(store, {
        salaryCurrency,
        docType: 'job_preview',
        applicationStatus: null,
      });
    },

    /**
     * D3b: applicationStatus activo → `docType=application` y limpia modality/currency.
     */
    setApplicationStatus(applicationStatus: ApplicationStatus | null): void {
      if (applicationStatus === null) {
        patchState(store, { applicationStatus: null });
        return;
      }
      patchState(store, {
        applicationStatus,
        docType: 'application',
        modality: null,
        salaryCurrency: null,
      });
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
      // D3b: re-forzar docType por si el usuario cambió el tipo tras activar un filtro LatAm.
      const modality = store.modality();
      const applicationStatus = store.applicationStatus();
      const salaryCurrency = store.salaryCurrency();
      const latamDocType: SearchDocType | null =
        applicationStatus !== null
          ? 'application'
          : modality !== null || salaryCurrency !== null
            ? 'job_preview'
            : null;
      if (latamDocType !== null && store.docType() !== latamDocType) {
        patchState(store, { docType: latamDocType });
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
          ...(modality !== null ? { modality } : {}),
          ...(applicationStatus !== null ? { applicationStatus } : {}),
          ...(salaryCurrency !== null ? { salaryCurrency } : {}),
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
