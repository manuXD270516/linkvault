import { computed, inject } from '@angular/core';
import type { ImportLinksResponse, JobLinkSummary, SaveLinkResponse } from '@linkvault/shared';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { type RequestFailure, toRequestFailure } from '../api/api-error';
import { LINKS_PAGE_SIZE, LinksApi } from './links.api';

/**
 * De dónde es la lista que se está mirando: los links de un grupo o los que el usuario guardó solo para sí. Las dos
 * vistas comparten pantalla (lista, guardar, importar y quitar), así que comparten store; lo único que cambia es a qué
 * endpoint van las peticiones.
 */
export type LinksScope = { kind: 'group'; groupId: string } | { kind: 'mine' };

/**
 * Lista de links paginada por cursor (D9). `loaded` distingue "todavía no se ha pedido" de "no hay links", que es lo que
 * decide el estado vacío; `total` es el número de links del listado entero, no el de los cargados.
 */
export interface LinksState {
  scope: LinksScope | null;
  items: JobLinkSummary[];
  total: number;
  /** Cursor opaco de la página siguiente; `null` cuando ya no hay más. */
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  loaded: boolean;
  /** Fallo de la última carga; las acciones propagan su error al llamante, que lo traduce por código. */
  failure: RequestFailure | null;
}

const initialState: LinksState = {
  scope: null,
  items: [],
  total: 0,
  nextCursor: null,
  loading: false,
  loadingMore: false,
  loaded: false,
  failure: null,
};

export const LinksStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ items, loaded, nextCursor }) => ({
    isEmpty: computed(() => loaded() && items().length === 0),
    hasMore: computed(() => nextCursor() !== null),
  })),
  withMethods((store, api = inject(LinksApi)) => {
    const groupIdOf = (scope: LinksScope | null): string | null =>
      scope?.kind === 'group' ? scope.groupId : null;

    const fetchPage = (scope: LinksScope, cursor?: string) =>
      scope.kind === 'group'
        ? api.listGroupLinks(scope.groupId, { limit: LINKS_PAGE_SIZE, cursor })
        : api.listMyLinks({ limit: LINKS_PAGE_SIZE, cursor });

    /**
     * Recarga desde la primera página, descartando lo ya cargado: tras guardar, importar o quitar, el orden y el `total`
     * cambian, y seguir paginando sobre un cursor viejo repetiría u omitiría links. Nunca rechaza, para que un fallo de
     * la recarga no se confunda con el de la acción.
     */
    const reload = async (): Promise<void> => {
      const scope = store.scope();
      if (scope === null) {
        return;
      }
      patchState(store, { loading: true, failure: null });
      try {
        const page = await fetchPage(scope);
        patchState(store, {
          items: page.items,
          total: page.total,
          nextCursor: page.nextCursor ?? null,
          loaded: true,
        });
      } catch (error: unknown) {
        patchState(store, { failure: toRequestFailure(error) });
      } finally {
        patchState(store, { loading: false });
      }
    };

    return {
      /** Entra en una lista: olvida la anterior (podría ser la de otro grupo) y carga su primera página. */
      async open(scope: LinksScope): Promise<void> {
        patchState(store, { ...initialState, scope });
        await reload();
      },

      reload,

      /** Trae la página siguiente y la añade al final; sin cursor o con una carga en curso no hace nada. */
      async loadMore(): Promise<void> {
        const scope = store.scope();
        const cursor = store.nextCursor();
        if (scope === null || cursor === null || store.loading() || store.loadingMore()) {
          return;
        }
        patchState(store, { loadingMore: true, failure: null });
        try {
          const page = await fetchPage(scope, cursor);
          patchState(store, {
            items: [...store.items(), ...page.items],
            total: page.total,
            nextCursor: page.nextCursor ?? null,
          });
        } catch (error: unknown) {
          patchState(store, { failure: toRequestFailure(error) });
        } finally {
          patchState(store, { loadingMore: false });
        }
      },

      /** Guarda una URL en la lista abierta y recarga; el error viaja al formulario, que lo traduce por código. */
      async save(url: string): Promise<SaveLinkResponse> {
        const response = await api.saveLink(url, groupIdOf(store.scope()) ?? undefined);
        await reload();
        return response;
      },

      /** Importa el texto pegado en la lista abierta y recarga con lo que haya entrado. */
      async importText(text: string): Promise<ImportLinksResponse> {
        const response = await api.importLinks(text, groupIdOf(store.scope()) ?? undefined);
        await reload();
        return response;
      },

      /** Quita el link de la lista abierta (solo la relación) y recarga. */
      async remove(linkId: string): Promise<void> {
        const groupId = groupIdOf(store.scope());
        await (groupId === null ? api.removeMyLink(linkId) : api.removeGroupLink(groupId, linkId));
        await reload();
      },

      /** Olvida la lista al salir de la pantalla, para que la siguiente no muestre la anterior mientras carga. */
      close(): void {
        patchState(store, initialState);
      },
    };
  }),
);

export type LinksStore = InstanceType<typeof LinksStore>;
