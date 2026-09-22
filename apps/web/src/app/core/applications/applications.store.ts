import { computed, effect, inject, untracked } from '@angular/core';
import type {
  Application,
  ApplicationEvent,
  ApplicationStatus,
  ApplicationVisibility,
  GroupTracker,
  TrackLinkResponse,
} from '@linkvault/shared';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withState,
} from '@ngrx/signals';
import { type RequestFailure, hasApiErrorCode, toRequestFailure } from '../api/api-error';
import { SessionStore } from '../auth/session.store';
import { ApplicationsApi, chunksOf } from './applications.api';

/** Estados compartidos de los links cargados de un grupo: `linkId` → quién comparte y en qué estado. */
export type GroupTrackersByLink = Record<string, GroupTracker[]>;

/**
 * Cambio de estado pedido por la UI. `stageLabel` omitido conserva la etapa si ya estaba en `in_process`, `null` la
 * borra; `appliedAt` se omite con "Hoy" (manda el reloj del servidor) y lleva la medianoche local de otro día (D3).
 * `groupId` opcional: contexto de la vista de grupo (change notifications, D8).
 */
export interface StatusChange {
  status: ApplicationStatus;
  stageLabel?: string | null;
  appliedAt?: string;
  groupId?: string;
}

/** Lo que basta de una postulación para operar sobre ella: el id capturado en el gesto y el link que la pinta. */
export interface ApplicationRef {
  id: string;
  linkId: string;
}

/**
 * Postulaciones de la persona en el SPA (D11 de applications-tracking).
 * - `byLinkId`: las propias, por `linkId`; las leen el tablero, las tarjetas de link y el panel.
 * - `shared`: los estados compartidos por grupo y link. Un `linkId` presente dice que ese link está en el grupo, aunque
 *   nadie lo comparta (lista vacía); uno ausente, que no se ha pedido o que ya no está.
 * - `userId`: de quién son los datos. Si cambia el usuario de la sesión se descarta todo (critic 5).
 */
export interface ApplicationsState {
  userId: string | null;
  byLinkId: Record<string, Application>;
  shared: Record<string, GroupTrackersByLink>;
  boardLoaded: boolean;
  boardLoading: boolean;
  boardFailure: RequestFailure | null;
}

const initialState: ApplicationsState = {
  userId: null,
  byLinkId: {},
  shared: {},
  boardLoaded: false,
  boardLoading: false,
  boardFailure: null,
};

/** Una postulación que se dejó de seguir en otra pestaña: el resultado pedido ya no aplica y no es un error (D11). */
function isGone(error: unknown): boolean {
  return hasApiErrorCode(error, 404, 'application_not_found');
}

export function isApplicationConflict(error: unknown): boolean {
  return hasApiErrorCode(error, 409, 'application_conflict');
}

export const ApplicationsStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ byLinkId }) => ({
    /** Las propias, de la cambiada más recientemente a la más antigua, como las devuelve la API. */
    applications: computed(() =>
      Object.values(byLinkId()).sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
      ),
    ),
  })),
  withMethods(
    (store, api = inject(ApplicationsApi), session = inject(SessionStore)) => {
      /** `true` si la respuesta llega para la misma sesión que la pidió; si no, se descarta sin tocar nada. */
      const stillFor = (owner: string | null): boolean => store.userId() === owner;

      /**
       * Pone o quita la entrada propia en los estados compartidos de ese link, en cada grupo cargado donde está, con la
       * respuesta de la API y sin otra petición (critic 6). Compartida: se añade con su nombre y su estado, primera si
       * su estado cambió (es el cambio más reciente); privada o borrada: se quita.
       */
      const syncOwnTracker = (linkId: string, application: Application | null): void => {
        const user = session.user();
        if (user === null) {
          return;
        }
        const shared = store.shared();
        let changed = false;
        const next: Record<string, GroupTrackersByLink> = {};
        for (const [groupId, byLink] of Object.entries(shared)) {
          const trackers = byLink[linkId];
          if (trackers === undefined) {
            next[groupId] = byLink;
            continue;
          }
          const updated = withOwnTracker(trackers, user.id, user.displayName, application);
          changed ||= updated !== trackers;
          next[groupId] = updated === trackers ? byLink : { ...byLink, [linkId]: updated };
        }
        if (changed) {
          patchState(store, { shared: next });
        }
      };

      const put = (application: Application): void => {
        patchState(store, {
          byLinkId: { ...store.byLinkId(), [application.linkId]: application },
        });
        syncOwnTracker(application.linkId, application);
      };

      /** Quita una postulación que ya no existe, del tablero y de los compartidos. */
      const drop = (ref: ApplicationRef): void => {
        const current = store.byLinkId()[ref.linkId];
        if (current !== undefined && current.id === ref.id) {
          const rest = { ...store.byLinkId() };
          delete rest[ref.linkId];
          patchState(store, { byLinkId: rest });
        }
        syncOwnTracker(ref.linkId, null);
      };

      /** Sustituye lo que había de esos links por lo que devolvió la API: lo que ya no viene, se quita (critic 5). */
      const replaceOwn = (linkIds: readonly string[], items: readonly Application[]): void => {
        const next = { ...store.byLinkId() };
        for (const linkId of linkIds) {
          delete next[linkId];
        }
        for (const item of items) {
          next[item.linkId] = item;
        }
        patchState(store, { byLinkId: next });
      };

      const loadBoard = async (): Promise<void> => {
        const owner = store.userId();
        patchState(store, { boardLoading: true, boardFailure: null });
        try {
          const items = await api.list();
          if (!stillFor(owner)) {
            return;
          }
          patchState(store, {
            byLinkId: Object.fromEntries(items.map((item) => [item.linkId, item])),
            boardLoaded: true,
          });
        } catch (error: unknown) {
          if (stillFor(owner)) {
            patchState(store, { boardFailure: toRequestFailure(error) });
          }
        } finally {
          if (stillFor(owner)) {
            patchState(store, { boardLoading: false });
          }
        }
      };

      /**
       * Estado propio de esos links, por bloques de hasta 50 (critic 13). Nunca rechaza: sin su estado, las tarjetas
       * siguen ofreciendo los gestos, y un fallo aquí no debe tapar la lista.
       */
      const loadOwn = async (linkIds: readonly string[]): Promise<void> => {
        const owner = store.userId();
        await Promise.all(
          chunksOf([...new Set(linkIds)]).map(async (chunk) => {
            try {
              const items = await api.list(chunk);
              if (stillFor(owner)) {
                replaceOwn(chunk, items);
              }
            } catch {
              // Se vuelve a pedir con la página siguiente, al volver a entrar o al recargar.
            }
          }),
        );
      };

      /** Tras un `409`, vuelve a pedir lo que se está mirando: el tablero entero o solo ese link. */
      const refreshAfterConflict = async (ref: ApplicationRef): Promise<void> => {
        if (store.boardLoaded()) {
          await loadBoard();
        } else {
          await loadOwn([ref.linkId]);
        }
      };

      return {
        loadBoard,
        loadOwn,

        /** Quién comparte su estado sobre esos links en el grupo, por bloques de hasta 50. Nunca rechaza. */
        async loadShared(groupId: string, linkIds: readonly string[]): Promise<void> {
          const owner = store.userId();
          await Promise.all(
            chunksOf([...new Set(linkIds)]).map(async (chunk) => {
              try {
                const items = await api.groupTrackers(groupId, chunk);
                if (!stillFor(owner)) {
                  return;
                }
                const byLink = { ...(store.shared()[groupId] ?? {}) };
                for (const linkId of chunk) {
                  delete byLink[linkId];
                }
                for (const item of items) {
                  byLink[item.linkId] = item.trackers;
                }
                patchState(store, { shared: { ...store.shared(), [groupId]: byLink } });
              } catch {
                // Sin avatares la tarjeta sigue siendo útil; se vuelven a pedir al recuperar el foco.
              }
            }),
          );
        },

        /** Empieza a seguir un link con el primer gesto. El error viaja a quien lo pidió. */
        async track(
          linkId: string,
          status: ApplicationStatus,
          appliedAt?: string,
        ): Promise<TrackLinkResponse> {
          const owner = store.userId();
          const response = await api.track(
            appliedAt === undefined ? { linkId, status } : { linkId, status, appliedAt },
          );
          if (stillFor(owner)) {
            put(response.application);
          }
          return response;
        },

        /**
         * Cambia el estado o la etapa con la `version` que se pintó. Devuelve la postulación nueva, o `null` si ya no
         * existía (se quita sin error). Un `409` vuelve a pedir lo que se mira y se propaga para que se explique.
         */
        async changeStatus(
          application: Pick<Application, 'id' | 'linkId' | 'version'>,
          change: StatusChange,
        ): Promise<Application | null> {
          const owner = store.userId();
          try {
            const updated = await api.changeStatus(application.id, {
              ...change,
              version: application.version,
            });
            if (stillFor(owner)) {
              put(updated);
            }
            return updated;
          } catch (error: unknown) {
            if (isGone(error)) {
              drop(application);
              return null;
            }
            if (isApplicationConflict(error)) {
              await refreshAfterConflict(application);
            }
            throw error;
          }
        },

        /** Notas o visibilidad de la postulación capturada. `null` si ya no existía. */
        async update(
          ref: ApplicationRef,
          body: { notes?: string; visibility?: ApplicationVisibility },
        ): Promise<Application | null> {
          const owner = store.userId();
          try {
            const updated = await api.update(ref.id, body);
            if (stillFor(owner)) {
              put(updated);
            }
            return updated;
          } catch (error: unknown) {
            if (isGone(error)) {
              drop(ref);
              return null;
            }
            throw error;
          }
        },

        /** Deja de seguir: un `404` ya es el resultado pedido (critic 7). */
        async untrack(ref: ApplicationRef): Promise<void> {
          try {
            await api.untrack(ref.id);
          } catch (error: unknown) {
            if (!isGone(error)) {
              throw error;
            }
          }
          drop(ref);
        },

        /** Historial del más antiguo al más reciente; `null` si la postulación ya no existe. */
        async timeline(ref: ApplicationRef): Promise<ApplicationEvent[] | null> {
          try {
            return await api.timeline(ref.id);
          } catch (error: unknown) {
            if (isGone(error)) {
              drop(ref);
              return null;
            }
            throw error;
          }
        },

        /** Quita una postulación sabida inexistente sin pedir nada (p. ej. un `404` recibido por otra vía). */
        forget(ref: ApplicationRef): void {
          drop(ref);
        },

        /** Descarta todo lo guardado y lo apunta a otro usuario (o a ninguno). */
        resetFor(userId: string | null): void {
          patchState(store, { ...initialState, userId });
        },
      };
    },
  ),
  withHooks({
    /**
     * Se reinicia entero cuando cambia el usuario de la sesión (cierre de sesión u otra cuenta), para que nada de una
     * sesión se vea en la siguiente. Las respuestas que lleguen tarde de la anterior se descartan (`stillFor`).
     */
    onInit(store, session = inject(SessionStore)) {
      // Se apunta ya al usuario actual: si esperase al primer efecto, una respuesta que llegase antes se descartaría.
      store.resetFor(session.user()?.id ?? null);
      effect(() => {
        const userId = session.user()?.id ?? null;
        untracked(() => {
          if (store.userId() !== userId) {
            store.resetFor(userId);
          }
        });
      });
    },
  }),
);

export type ApplicationsStore = InstanceType<typeof ApplicationsStore>;

/**
 * La lista de quién comparte, con la entrada propia puesta al día. Devuelve la misma lista si no cambia nada, para no
 * repintar las tarjetas de otros links.
 */
function withOwnTracker(
  trackers: GroupTracker[],
  userId: string,
  displayName: string,
  application: Application | null,
): GroupTracker[] {
  const index = trackers.findIndex((tracker) => tracker.userId === userId);
  const shares = application !== null && application.visibility === 'group';
  if (!shares) {
    return index === -1 ? trackers : trackers.filter((tracker) => tracker.userId !== userId);
  }
  const own: GroupTracker = { userId, displayName, status: application.status };
  if (index !== -1 && trackers[index].status === own.status) {
    return trackers[index].displayName === displayName
      ? trackers
      : trackers.map((tracker, at) => (at === index ? own : tracker));
  }
  return [own, ...trackers.filter((tracker) => tracker.userId !== userId)];
}
