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

/** Resultado visible del CTA Guardar por URL (D4 / ADR-045). */
export type DiscoverySaveOutcome = 'created' | 'already' | 'error';

/**
 * Destino de página para Guardar: privado (`null`) o `groupId` de un grupo del usuario
 * (ADR-045 D1–D2).
 */
export type DiscoverySaveDestination = string | null;

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
  /** Destino de página: `null` = privado (default). */
  saveDestination: DiscoverySaveDestination;
  /** Feedback de guardado indexado por URL canónica del hit. */
  saveOutcomes: Record<string, DiscoverySaveOutcome>;
  /**
   * Destino al que se envió cada guardado, capturado al click. Se escribe junto a `saveOutcomes`
   * para que no haya resultado sin destino.
   */
  saveDestinations: Record<string, DiscoverySaveDestination>;
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
  saveDestination: null,
  saveOutcomes: {},
  saveDestinations: {},
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

    /** Cambia el destino de página (Privado | grupo). No re-guarda hits previos. */
    setSaveDestination(destination: DiscoverySaveDestination): void {
      patchState(store, { saveDestination: destination });
    },

    /**
     * Si el `groupId` seleccionado ya no está en `allowedIds`, resetea a Privado
     * (ADR-045 D5b).
     */
    ensureDestinationAllowed(allowedIds: readonly string[]): void {
      const current = store.saveDestination();
      if (current !== null && !allowedIds.includes(current)) {
        patchState(store, { saveDestination: null });
      }
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
        saveDestinations: {},
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
     * Guarda el hit vía `POST /api/links` (ADR-045). Captura `groupId` al inicio del
     * handler (antes de `await`) para no mezclar destino mid-flight.
     */
    async save(hit: DiscoveryHit): Promise<void> {
      const url = hit.url;
      // Captura al click (D5): no releer el signal tras awaits.
      const groupId = store.saveDestination();
      if (store.savingUrls()[url] === true) {
        return;
      }
      const priorOutcomes = { ...store.saveOutcomes() };
      delete priorOutcomes[url];
      const priorDestinations = { ...store.saveDestinations() };
      delete priorDestinations[url];
      patchState(store, {
        savingUrls: { ...store.savingUrls(), [url]: true },
        saveOutcomes: priorOutcomes,
        saveDestinations: priorDestinations,
      });
      try {
        const response =
          groupId === null
            ? await links.saveLink(url)
            : await links.saveLink(url, groupId);
        const outcome: DiscoverySaveOutcome =
          response.shared === 'already_there' ? 'already' : 'created';
        patchState(store, {
          saveOutcomes: { ...store.saveOutcomes(), [url]: outcome },
          saveDestinations: { ...store.saveDestinations(), [url]: groupId },
        });
      } catch {
        patchState(store, {
          saveOutcomes: { ...store.saveOutcomes(), [url]: 'error' },
          saveDestinations: { ...store.saveDestinations(), [url]: groupId },
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
