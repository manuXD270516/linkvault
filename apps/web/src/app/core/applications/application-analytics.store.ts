import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { type RequestFailure, toRequestFailure } from '../api/api-error';
import {
  type ApplicationAnalyticsResponse,
  emptyApplicationAnalytics,
  isAnalyticsEmpty,
} from './application-analytics';
import { ApplicationsApi } from './applications.api';

/**
 * Funnel personal de `GET /api/applications/analytics` (spec web/analytics). Lo provee la página
 * de insights (no `root`): al salir se destruye.
 */
export interface ApplicationAnalyticsState {
  analytics: ApplicationAnalyticsResponse;
  loading: boolean;
  loaded: boolean;
  failure: RequestFailure | null;
}

const initialState: ApplicationAnalyticsState = {
  analytics: emptyApplicationAnalytics(),
  loading: false,
  loaded: false,
  failure: null,
};

export const ApplicationAnalyticsStore = signalStore(
  withState(initialState),
  withComputed(({ analytics, loaded }) => ({
    isEmpty: computed(() => loaded() && isAnalyticsEmpty(analytics())),
  })),
  withMethods((store, api = inject(ApplicationsApi)) => ({
    async load(): Promise<void> {
      patchState(store, { loading: true, failure: null });
      try {
        patchState(store, { analytics: await api.analytics(), loaded: true });
      } catch (error: unknown) {
        patchState(store, { failure: toRequestFailure(error) });
      } finally {
        patchState(store, { loading: false });
      }
    },
  })),
);

export type ApplicationAnalyticsStore = InstanceType<typeof ApplicationAnalyticsStore>;
