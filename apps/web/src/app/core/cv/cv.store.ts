import { computed, inject } from '@angular/core';
import type { CvDocument } from '@linkvault/shared';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { filter, firstValueFrom, map, tap } from 'rxjs';
import { type RequestFailure, hasApiErrorCode, toRequestFailure } from '../api/api-error';
import { CvApi } from './cv.api';

/** Cada cuánto se vuelve a pedir la lista mientras alguna lectura sigue en curso (D8). */
export const CV_POLL_INTERVAL_MS = 2_000;
/** Cuánto dura una ventana de sondeo: 60 s, es decir 30 vueltas. Agotada, la pantalla ofrece su salida (D13). */
export const CV_POLL_WINDOW_MS = 60_000;
const CV_POLLS_PER_WINDOW = CV_POLL_WINDOW_MS / CV_POLL_INTERVAL_MS;

/**
 * Lo que la pantalla `/mi-cv` necesita saber (D13). `loaded` distingue "todavía no se ha pedido" de "no tiene ningún
 * CV", que es lo que decide el estado vacío; los tres fallos van separados porque se leen en sitios distintos: el de la
 * lista con "Reintentar", el de la subida junto al botón y el de marcar o eliminar junto a la lista.
 */
export interface CvState {
  items: CvDocument[];
  loading: boolean;
  loaded: boolean;
  failure: RequestFailure | null;
  uploading: boolean;
  /** Porcentaje subido, o `null` mientras no se sepa; solo tiene sentido con `uploading`. */
  uploadPercent: number | null;
  uploadFailure: RequestFailure | null;
  actionFailure: RequestFailure | null;
  /** `true` cuando se agotó la ventana de sondeo y alguna lectura sigue en curso: "Sigue en proceso". */
  stalled: boolean;
}

const initialState: CvState = {
  items: [],
  loading: false,
  loaded: false,
  failure: null,
  uploading: false,
  uploadPercent: null,
  uploadFailure: null,
  actionFailure: null,
  stalled: false,
};

/**
 * Los CV guardados de la persona, con el sondeo de las lecturas en curso (D8, spec web/cv).
 *
 * **No es `providedIn: 'root'`**: lo provee la página, para que salir de `/mi-cv` lo destruya y con él el sondeo. Un
 * store de raíz seguiría pidiendo la lista desde otra pantalla, que es justo lo que la spec prohíbe.
 */
export const CvStore = signalStore(
  withState(initialState),
  withComputed(({ items, loaded }) => ({
    isEmpty: computed(() => loaded() && items().length === 0),
    /** `true` mientras alguna lectura siga en curso: es lo que mantiene abierto el sondeo. */
    hasPending: computed(() => items().some((item) => item.extraction.status === 'pending')),
    /** El CV marcado, o `null` si no hay ninguno (lista vacía). */
    defaultCv: computed(() => items().find((item) => item.isDefault) ?? null),
    /** El más reciente que sí se pudo leer, que es el que ofrece "Usar el que sí se leyó" (D13). */
    newestExtracted: computed(
      () => items().find((item) => item.extraction.status === 'extracted') ?? null,
    ),
  })),
  withMethods((store, api = inject(CvApi)) => {
    let timer: ReturnType<typeof setInterval> | null = null;
    /**
     * Vueltas que le quedan a la ventana abierta. Se cuentan vueltas y no relojes para que la ventana signifique lo
     * mismo aunque una respuesta tarde: 30 vueltas de 2 s son los 60 s que anuncia la spec.
     */
    let pollsLeft = 0;

    const stopPolling = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    /** Pide la lista; en un sondeo un fallo no borra lo que se ve ni corta la ventana. */
    const fetchList = async (silent: boolean): Promise<void> => {
      if (!silent) {
        patchState(store, { loading: true, failure: null });
      }
      try {
        patchState(store, { items: await api.list(), loaded: true });
      } catch (error: unknown) {
        if (!silent) {
          patchState(store, { failure: toRequestFailure(error) });
        }
      } finally {
        if (!silent) {
          patchState(store, { loading: false });
        }
      }
    };

    /** Una vuelta del sondeo: pide la lista y decide si la ventana sigue, se cierra o se agota. */
    const poll = async (): Promise<void> => {
      pollsLeft -= 1;
      await fetchList(true);
      if (!store.hasPending()) {
        stopPolling();
        return;
      }
      if (pollsLeft <= 0) {
        stopPolling();
        patchState(store, { stalled: true });
      }
    };

    /**
     * Abre (o reabre) una ventana de 60 s si hay algo que esperar. Es lo que hace "Actualizar": vuelve a dar otros
     * 60 s, porque un botón que solo pide una vez deja a la persona pulsando.
     */
    const openWindow = (): void => {
      stopPolling();
      patchState(store, { stalled: false });
      if (!store.hasPending()) {
        return;
      }
      pollsLeft = CV_POLLS_PER_WINDOW;
      timer = setInterval(() => void poll(), CV_POLL_INTERVAL_MS);
    };

    const load = async (): Promise<void> => {
      await fetchList(false);
      openWindow();
    };

    return {
      load,

      /** "Reintentar" de la lista y "Actualizar" del aviso: pide la lista y reanuda otra ventana de sondeo. */
      refresh: load,

      /**
       * Sube el archivo contando el progreso. El CV nuevo se pone arriba de la lista sin volver a pedirla y, como nace
       * en `pending`, abre la ventana de sondeo. Un segundo intento mientras hay uno en curso no hace nada.
       */
      async upload(file: File): Promise<void> {
        if (store.uploading()) {
          return;
        }
        patchState(store, { uploading: true, uploadPercent: null, uploadFailure: null });
        try {
          const document = await firstValueFrom(
            api.upload(file).pipe(
              tap((event) => {
                if (event.kind === 'progress') {
                  patchState(store, { uploadPercent: event.percent });
                }
              }),
              filter((event) => event.kind === 'uploaded'),
              map((event) => event.document),
            ),
          );
          // La subida nueva se lleva la marca (D4): el resto deja de tenerla sin pedir la lista otra vez.
          patchState(store, {
            items: [
              document,
              ...store.items().map((item) => (item.isDefault ? { ...item, isDefault: false } : item)),
            ],
            loaded: true,
          });
          openWindow();
        } catch (error: unknown) {
          patchState(store, { uploadFailure: toRequestFailure(error) });
        } finally {
          patchState(store, { uploading: false, uploadPercent: null });
        }
      },

      /**
       * Mueve la marca a ese CV. Se mueve en el acto y **vuelve donde estaba** si la API falla, como el interruptor de
       * `defaultVisibility` (ADR-027 §7): no destruye nada, así que no se pide confirmación.
       */
      async setDefault(cvId: string): Promise<void> {
        const previous = store.items();
        patchState(store, {
          actionFailure: null,
          items: previous.map((item) => ({ ...item, isDefault: item.id === cvId })),
        });
        try {
          patchState(store, { items: await api.setDefault(cvId) });
        } catch (error: unknown) {
          patchState(store, { items: previous, actionFailure: toRequestFailure(error) });
        }
      },

      /** Elimina el CV y su archivo. Un `404` ya es lo pedido —se borró en otra pestaña—: se recarga la lista. */
      async remove(cvId: string): Promise<void> {
        patchState(store, { actionFailure: null });
        try {
          patchState(store, { items: await api.remove(cvId) });
        } catch (error: unknown) {
          if (hasApiErrorCode(error, 404, 'cv_not_found')) {
            await fetchList(false);
            return;
          }
          patchState(store, { actionFailure: toRequestFailure(error) });
        }
      },

      /** Detiene el sondeo: lo llama el hook al destruirse la página y los tests que no quieren relojes vivos. */
      stopPolling,
    };
  }),
  withHooks({
    // Salir de `/mi-cv` destruye el store, y con él la ventana de sondeo: ninguna petición más desde otra pantalla.
    onDestroy(store) {
      store.stopPolling();
    },
  }),
);

export type CvStore = InstanceType<typeof CvStore>;
