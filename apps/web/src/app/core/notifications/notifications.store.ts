import { inject } from '@angular/core';
import type {
  NotificationPreferences,
  PatchNotificationPreferencesRequest,
} from '@linkvault/shared';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@linkvault/shared';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { type RequestFailure, toRequestFailure } from '../api/api-error';
import { NotificationsApi } from './notifications.api';

/**
 * Preferencias de aviso del perfil (spec web/notifications). Lo provee la página de notificaciones (no `root`):
 * al salir se destruye.
 */
export interface NotificationsState {
  preferences: NotificationPreferences;
  loading: boolean;
  loaded: boolean;
  saving: boolean;
  failure: RequestFailure | null;
  saveFailure: RequestFailure | null;
}

const initialState: NotificationsState = {
  preferences: DEFAULT_NOTIFICATION_PREFERENCES,
  loading: false,
  loaded: false,
  saving: false,
  failure: null,
  saveFailure: null,
};

export const NotificationsStore = signalStore(
  withState(initialState),
  withMethods((store, api = inject(NotificationsApi)) => ({
    async load(): Promise<void> {
      patchState(store, { loading: true, failure: null });
      try {
        patchState(store, { preferences: await api.getPreferences(), loaded: true });
      } catch (error: unknown) {
        patchState(store, { failure: toRequestFailure(error) });
      } finally {
        patchState(store, { loading: false });
      }
    },

    async save(patch: PatchNotificationPreferencesRequest): Promise<boolean> {
      patchState(store, { saving: true, saveFailure: null });
      try {
        patchState(store, { preferences: await api.patchPreferences(patch), loaded: true });
        return true;
      } catch (error: unknown) {
        patchState(store, { saveFailure: toRequestFailure(error) });
        return false;
      } finally {
        patchState(store, { saving: false });
      }
    },
  })),
);

export type NotificationsStore = InstanceType<typeof NotificationsStore>;
