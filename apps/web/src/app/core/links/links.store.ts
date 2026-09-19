import { DestroyRef, computed, inject } from '@angular/core';
import type {
  ImportLinksResponse,
  JobLinkSummary,
  LinkPage,
  PastedDescriptionRequest,
  PreviewFieldName,
  SaveLinkResponse,
  UpdatePreviewRequest,
} from '@linkvault/shared';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withState,
} from '@ngrx/signals';
import { type RequestFailure, toRequestFailure } from '../api/api-error';
import { EventsChannel } from '../events/events.channel';
import { LINKS_PAGE_SIZE, LinksApi } from './links.api';

/**
 * De dónde es la lista que se está mirando: los links de un grupo o los que el usuario guardó solo para sí. Las dos
 * vistas comparten pantalla (lista, guardar, importar y quitar), así que comparten store; lo único que cambia es a qué
 * endpoint van las peticiones.
 */
export type LinksScope = { kind: 'group'; groupId: string } | { kind: 'mine' };

/**
 * Cuántas lecturas van terminadas de las que se están esperando. `total` sale del listado entero o de lo que devolvió la
 * importación, **nunca** de contar los links de la página cargada: una importación de cincuenta ofertas no cabe en una
 * página de veinte, y el contador diría veinte.
 */
export interface ReadingProgress {
  done: number;
  total: number;
}

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
  /** Progreso de las lecturas en curso, o `null` cuando no se está esperando ninguna. */
  reading: ReadingProgress | null;
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
  reading: null,
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

    /** El ámbito abierto; sin ninguno, guardar o importar es un error de programación y no sale ninguna petición. */
    const openScope = (): LinksScope => {
      const scope = store.scope();
      if (scope === null) {
        throw new Error('No list is open: open a group or the private list before saving links');
      }
      return scope;
    };

    const fetchPage = (scope: LinksScope, cursor?: string) =>
      scope.kind === 'group'
        ? api.listGroupLinks(scope.groupId, { limit: LINKS_PAGE_SIZE, cursor })
        : api.listMyLinks({ limit: LINKS_PAGE_SIZE, cursor });

    /**
     * Número de la última carga de la lista (design D1). Sube con cada carga de la primera página y con `close()`: solo
     * la carga vigente escribe, y la respuesta, el error o la página siguiente de una carga superada se descartan. Vive
     * en el cierre y no en el estado porque no es algo que la UI deba observar.
     */
    let listLoad = 0;

    /** `true` si `load` sigue siendo la última carga; si no, su respuesta se descarta sin tocar nada. */
    const stillCurrent = (load: number): boolean => load === listLoad;

    /**
     * `true` si sigue abierta la misma lista que se capturó, comparando por valor (tipo y grupo) y no por identidad: lo
     * pedido en A vale si el usuario salió y volvió a A. Es lo que usan las acciones, que solo no deben cruzar de lista.
     */
    const stillOn = (scope: LinksScope | null): boolean => {
      const open = store.scope();
      if (open === null || scope === null) {
        return open === scope;
      }
      return open.kind === scope.kind && groupIdOf(open) === groupIdOf(scope);
    };

    /**
     * Carga la primera página como nueva carga vigente: deja sin efecto cualquier carga anterior y cualquier página
     * siguiente en vuelo (por eso apaga `loadingMore`). Devuelve su número si terminó bien, o `null` si no había lista
     * abierta o falló; nunca rechaza. Si otra carga la supera mientras espera, no toca el estado (design D2).
     */
    const loadFirstPage = async (): Promise<number | null> => {
      const scope = store.scope();
      if (scope === null) {
        return null;
      }
      const load = ++listLoad;
      patchState(store, { loading: true, loadingMore: false, failure: null });
      try {
        const page = await fetchPage(scope);
        if (!stillCurrent(load)) {
          return load;
        }
        patchState(store, {
          items: page.items,
          total: page.total,
          nextCursor: page.nextCursor ?? null,
          loaded: true,
          reading: readingOf(page),
        });
        return load;
      } catch (error: unknown) {
        if (stillCurrent(load)) {
          patchState(store, { failure: toRequestFailure(error) });
        }
        return null;
      } finally {
        if (stillCurrent(load)) {
          patchState(store, { loading: false });
        }
      }
    };

    /**
     * Recarga desde la primera página, descartando lo ya cargado: tras guardar, importar o quitar, el orden y el `total`
     * cambian, y seguir paginando sobre un cursor viejo repetiría u omitiría links. Nunca rechaza, para que un fallo de
     * la recarga no se confunda con el de la acción.
     */
    const reload = async (): Promise<void> => {
      await loadFirstPage();
    };

    /**
     * Reemplaza la tarjeta de un link ya cargado, sin tocar el orden, el `total` ni el cursor: es lo que hace que una
     * corrección a mano o un aviso del canal de eventos se vean sin volver a pedir la lista. Un link que no está en la
     * lista abierta se ignora: puede ser de otro grupo, o de una página que todavía no se ha cargado.
     */
    const replace = (link: JobLinkSummary): void => {
      const items = store.items();
      const index = items.findIndex((item) => item.id === link.id);
      if (index === -1) {
        return;
      }
      patchState(store, { items: items.map((item, at) => (at === index ? link : item)) });
    };

    /**
     * Reemplaza la tarjeta que devolvió una edición solo si sigue abierta la lista donde se pidió: `sharedBy` y
     * `sharedAt` son de esa lista, y en otra pisarían quién lo compartió allí (design D5). Una recarga de la misma lista
     * no la invalida.
     */
    const replaceIfStillOn = (scope: LinksScope | null, link: JobLinkSummary): void => {
      if (stillOn(scope)) {
        replace(link);
      }
    };

    return {
      /** Entra en una lista: olvida la anterior (podría ser la de otro grupo) y carga su primera página. */
      async open(scope: LinksScope): Promise<void> {
        patchState(store, { ...initialState, scope });
        await reload();
      },

      reload,

      /**
       * Trae la página siguiente y la añade al final; sin cursor o con una carga en curso no hace nada. Si mientras
       * espera se abre, cierra o recarga la lista, la página es de un cursor viejo y se descarta entera, incluido el fin
       * de `loadingMore`, que ya apagó la carga nueva (design D3).
       */
      async loadMore(): Promise<void> {
        const scope = store.scope();
        const cursor = store.nextCursor();
        if (scope === null || cursor === null || store.loading() || store.loadingMore()) {
          return;
        }
        const load = listLoad;
        patchState(store, { loadingMore: true, failure: null });
        try {
          const page = await fetchPage(scope, cursor);
          if (stillCurrent(load)) {
            patchState(store, {
              items: [...store.items(), ...page.items],
              total: page.total,
              nextCursor: page.nextCursor ?? null,
            });
          }
        } catch (error: unknown) {
          if (stillCurrent(load)) {
            patchState(store, { failure: toRequestFailure(error) });
          }
        } finally {
          if (stillCurrent(load)) {
            patchState(store, { loadingMore: false });
          }
        }
      },

      /**
       * Guarda una URL en la lista abierta y recarga; el error viaja al formulario, que lo traduce por código. Sin lista
       * abierta no envía nada: el destino (grupo o lista privada) sale del ámbito, y adivinarlo sería guardar donde no
       * se pidió. Si al responder ya está abierta otra lista, no la recarga: esa ya la cargó su propio `open` (design D4).
       */
      async save(url: string): Promise<SaveLinkResponse> {
        const scope = openScope();
        const response = await api.saveLink(url, groupIdOf(scope) ?? undefined);
        if (stillOn(scope)) {
          await loadFirstPage();
        }
        return response;
      },

      /**
       * Importa el texto pegado en la lista abierta y recarga con lo que haya entrado. Lo que va a leerse es lo que
       * acaba de entrar, así que el contador sale de la respuesta y no de la página: las ofertas nuevas pueden ser más
       * que los links que caben en ella. El contador solo se abre si la recarga terminó bien y sigue siendo la última:
       * en otra lista no son sus lecturas, y con la lista en error no avanzaría (design D4).
       */
      async importText(text: string): Promise<ImportLinksResponse> {
        const scope = openScope();
        const response = await api.importLinks(text, groupIdOf(scope) ?? undefined);
        if (!stillOn(scope)) {
          return response;
        }
        const load = await loadFirstPage();
        if (load !== null && stillCurrent(load) && response.created > 0) {
          patchState(store, { reading: { done: 0, total: response.created } });
        }
        return response;
      },

      replace,

      /**
       * Aplica el aviso de un link que terminó su lectura: reemplaza su tarjeta y suma uno al contador. Un aviso de un
       * link que no está en la lista abierta no cuenta; el contador desaparece cuando ya no queda nada por leer.
       */
      applyEnriched(link: JobLinkSummary): void {
        if (!store.items().some((item) => item.id === link.id)) {
          return;
        }
        replace(link);
        const reading = store.reading();
        if (reading === null) {
          return;
        }
        const done = reading.done + 1;
        patchState(store, {
          reading: done >= reading.total ? null : { ...reading, done },
        });
      },

      /**
       * Guarda la corrección a mano del preview y deja la tarjeta con lo que respondió la API. El error viaja al
       * formulario, que lo muestra sin perder lo escrito.
       */
      async updatePreview(linkId: string, body: UpdatePreviewRequest): Promise<JobLinkSummary> {
        const scope = store.scope();
        const link = await api.updatePreview(linkId, body);
        replaceIfStillOn(scope, link);
        return link;
      },

      /**
       * Completa la oferta con el texto pegado y deja la tarjeta con lo que respondió la API, esté en la vista que esté:
       * el diálogo se abre desde cualquier pantalla que muestre el link, y la tarjeta cambia sin recargar la lista. El
       * error viaja al diálogo, que lo explica sin perder lo pegado.
       */
      async pasteDescription(linkId: string, body: PastedDescriptionRequest): Promise<JobLinkSummary> {
        const scope = store.scope();
        const link = await api.pasteDescription(linkId, body);
        replaceIfStillOn(scope, link);
        return link;
      },

      /**
       * Deshace de una vez todos los campos de un mismo pegado ("Deshacer lo que pegó Ana"): es el `revert` de la
       * edición con la lista entera, en una sola petición, para que nadie vea la tarjeta a medio deshacer.
       */
      async undoPaste(linkId: string, fields: readonly PreviewFieldName[]): Promise<JobLinkSummary> {
        const scope = store.scope();
        const link = await api.updatePreview(linkId, { revert: [...fields] });
        replaceIfStillOn(scope, link);
        return link;
      },

      /** Vuelve a pedir la lectura de una oferta; la tarjeta queda como la devuelve la API, de vuelta en `pending`. */
      async retryEnrichment(linkId: string): Promise<JobLinkSummary> {
        const scope = store.scope();
        const link = await api.enrich(linkId);
        replaceIfStillOn(scope, link);
        return link;
      },

      /**
       * Quita el link de la lista abierta (solo la relación) y recarga; si al responder ya está abierta otra lista, no
       * la recarga (design D4).
       */
      async remove(linkId: string): Promise<void> {
        const scope = store.scope();
        const groupId = groupIdOf(scope);
        await (groupId === null ? api.removeMyLink(linkId) : api.removeGroupLink(groupId, linkId));
        if (stillOn(scope)) {
          await loadFirstPage();
        }
      },

      /**
       * Olvida la lista al salir de la pantalla, para que la siguiente no muestre la anterior mientras carga. Deja sin
       * efecto cualquier carga en vuelo: su respuesta ya no tiene dónde pintarse.
       */
      close(): void {
        listLoad++;
        patchState(store, initialState);
      },
    };
  }),
  withHooks({
    /**
     * Escucha los avisos del canal de eventos mientras la aplicación vive y vuelve a pedir la lista cuando la pestaña
     * recupera el foco. Lo segundo es lo que hace que la espera acabe aunque el canal no esté disponible: al volver a
     * mirar, lo que hay en pantalla es lo que dice la API.
     */
    onInit(store, channel = inject(EventsChannel), destroyRef = inject(DestroyRef)) {
      const subscription = channel.linkEnriched.subscribe(({ link }) => {
        store.applyEnriched(link);
      });
      const onVisibilityChange = (): void => {
        if (document.visibilityState === 'visible') {
          void store.reload();
        }
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      destroyRef.onDestroy(() => {
        subscription.unsubscribe();
        document.removeEventListener('visibilitychange', onVisibilityChange);
      });
    },
  }),
);

/**
 * Lecturas que se están esperando al cargar una lista: solo cuando todo lo cargado sigue sin leerse, y entonces son
 * tantas como links tiene el listado entero. Si ya hay ofertas leídas, no hay una espera que contar.
 */
function readingOf(page: LinkPage): ReadingProgress | null {
  const waiting =
    page.items.length > 0 && page.items.every((item) => item.previewStatus === 'pending');
  return waiting ? { done: 0, total: page.total } : null;
}

export type LinksStore = InstanceType<typeof LinksStore>;
