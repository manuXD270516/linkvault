import { computed, inject } from '@angular/core';
import type {
  DiscoveryBoard,
  DiscoveryDegraded,
  DiscoveryHit,
} from '@linkvault/shared';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { type RequestFailure, toRequestFailure } from '../api/api-error';
import { LinksApi } from '../links/links.api';
import { DiscoveryApi } from './discovery.api';

/** Resultado visible del CTA Guardar por URL (D4). */
export type DiscoverySaveOutcome = 'created' | 'already' | 'error';

/**
 * Estado de `/descubrir` (spec web/discovery). `searched` distingue "aún no se ha buscado" de
 * "0 hits". Lo provee la página (no `root`): al salir se destruye.
 */
export interface DiscoveryState {
  query: string;
  board: DiscoveryBoard;
  results: DiscoveryHit[];
  degraded: DiscoveryDegraded[];
  loading: boolean;
  /** `true` tras al menos una búsqueda enviada con éxito o con fallo. */
  searched: boolean;
  failure: RequestFailure | null;
  /** Feedback de guardado indexado por URL canónica del hit. */
  saveOutcomes: Record<string, DiscoverySaveOutcome>;
  /** URLs con POST /api/links en vuelo. */
  savingUrls: Record<string, true>;
}

const initialState: DiscoveryState = {
  query: '',
  board: 'all',
  results: [],
  degraded: [],
  loading: false,
  searched: false,
  failure: null,
  saveOutcomes: {},
  savingUrls: {},
};

export const DiscoveryStore = signalStore(
  withState(initialState),
  withComputed(({ results, searched, loading, failure }) => ({
    isEmpty: computed(
      () => searched() && !loading() && failure() === null && results().length === 0,
    ),
  })),
  withMethods((store, api = inject(DiscoveryApi), links = inject(LinksApi)) => ({
    setBoard(board: DiscoveryBoard): void {
      patchState(store, { board });
    },

    /**
     * Lanza la búsqueda. `q` vacío es válido (D2): la API lo acepta.
     */
    async run(q: string): Promise<void> {
      const trimmed = q.trim();
      patchState(store, {
        query: trimmed,
        loading: true,
        failure: null,
        degraded: [],
        saveOutcomes: {},
        savingUrls: {},
      });
      try {
        const response = await api.search({
          q: trimmed,
          board: store.board(),
        });
        patchState(store, {
          results: response.results,
          degraded: response.degraded ?? [],
          searched: true,
        });
      } catch (error: unknown) {
        patchState(store, {
          failure: toRequestFailure(error),
          results: [],
          degraded: [],
          searched: true,
        });
      } finally {
        patchState(store, { loading: false });
      }
    },

    /**
     * Guarda el hit en la lista privada (`POST /api/links` sin groupId) y deja feedback
     * creado / ya existía / error (D4 — no silencioso).
     */
    async save(hit: DiscoveryHit): Promise<void> {
      const url = hit.url;
      if (store.savingUrls()[url] === true) {
        return;
      }
      const priorOutcomes = { ...store.saveOutcomes() };
      delete priorOutcomes[url];
      patchState(store, {
        savingUrls: { ...store.savingUrls(), [url]: true },
        saveOutcomes: priorOutcomes,
      });
      try {
        const response = await links.saveLink(url);
        const outcome: DiscoverySaveOutcome =
          response.shared === 'already_there' ? 'already' : 'created';
        patchState(store, {
          saveOutcomes: { ...store.saveOutcomes(), [url]: outcome },
        });
      } catch {
        patchState(store, {
          saveOutcomes: { ...store.saveOutcomes(), [url]: 'error' },
        });
      } finally {
        const remaining = { ...store.savingUrls() };
        delete remaining[url];
        patchState(store, { savingUrls: remaining });
      }
    },
  })),
);

export type DiscoveryStore = InstanceType<typeof DiscoveryStore>;
