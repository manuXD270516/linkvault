import { computed, inject } from '@angular/core';
import type {
  AiKeyView,
  AiVendor,
  AiVendorAvailability,
  UpsertAiKeyRequest,
} from '@linkvault/shared';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import { type RequestFailure, toRequestFailure } from '../api/api-error';
import { AiKeysApi } from './ai-keys.api';

/**
 * Claves BYOK del perfil (spec web/byok). `loaded` distingue "aún no pedidas" de "sin claves".
 * Tras guardar o revocar se vuelve a listar para reflejar el API sin mostrar plaintext.
 */
export interface AiKeysState {
  keys: AiKeyView[];
  /**
   * Disponibilidad de **cada** vendor soportado tal y como la dice el API (`ListAiKeysResponse.vendors`).
   * No se deriva de `keys` ni de ninguna regla del cliente: es un hecho sobre la configuración del servidor.
   */
  vendors: AiVendorAvailability[];
  loading: boolean;
  loaded: boolean;
  failure: RequestFailure | null;
  /** Vendor cuya clave se está guardando o rotando. */
  savingVendor: AiVendor | null;
  /** Vendor cuya clave se está revocando. */
  revokingVendor: AiVendor | null;
  actionFailure: RequestFailure | null;
}

const initialState: AiKeysState = {
  keys: [],
  vendors: [],
  loading: false,
  loaded: false,
  failure: null,
  savingVendor: null,
  revokingVendor: null,
  actionFailure: null,
};

/**
 * Lo provee `/perfil` (no `root`): al salir se destruye. Un store de raíz dejaría claves en memoria
 * tras cerrar sesión en otra pantalla.
 */
export const AiKeysStore = signalStore(
  withState(initialState),
  withComputed(({ keys, vendors }) => ({
    hasAnyKey: computed(() => keys().length > 0),
    /** Vista por vendor, o `undefined` si no hay clave. */
    keyByVendor: computed((): ReadonlyMap<AiVendor, AiKeyView> => {
      const map = new Map<AiVendor, AiKeyView>();
      for (const key of keys()) {
        map.set(key.vendor, key);
      }
      return map;
    }),
    /**
     * Disponibilidad por vendor. `undefined` significa **todavía no lo sabemos** (listado sin responder):
     * no es «disponible», y la pantalla no afirma nada sobre ese vendor hasta tenerlo.
     */
    availabilityByVendor: computed((): ReadonlyMap<AiVendor, boolean> => {
      const map = new Map<AiVendor, boolean>();
      for (const entry of vendors()) {
        map.set(entry.vendor, entry.available);
      }
      return map;
    }),
  })),
  withMethods((store, api = inject(AiKeysApi)) => {
    const load = async (): Promise<void> => {
      patchState(store, { loading: true, failure: null });
      try {
        const { keys, vendors } = await api.list();
        patchState(store, { keys, vendors, loaded: true });
      } catch (error: unknown) {
        patchState(store, { failure: toRequestFailure(error) });
      } finally {
        patchState(store, { loading: false });
      }
    };

    return {
      load,

      /** Guarda o rota y refresca el listado. */
      async upsert(vendor: AiVendor, body: UpsertAiKeyRequest): Promise<void> {
        patchState(store, { savingVendor: vendor, actionFailure: null });
        try {
          await api.upsert(vendor, body);
          const { keys, vendors } = await api.list();
          patchState(store, { keys, vendors, loaded: true });
        } catch (error: unknown) {
          patchState(store, { actionFailure: toRequestFailure(error) });
          throw error;
        } finally {
          patchState(store, { savingVendor: null });
        }
      },

      /** Revoca y refresca el listado. */
      async revoke(vendor: AiVendor): Promise<void> {
        patchState(store, { revokingVendor: vendor, actionFailure: null });
        try {
          await api.remove(vendor);
          const { keys, vendors } = await api.list();
          patchState(store, { keys, vendors, loaded: true });
        } catch (error: unknown) {
          patchState(store, { actionFailure: toRequestFailure(error) });
          throw error;
        } finally {
          patchState(store, { revokingVendor: null });
        }
      },
    };
  }),
);

export type AiKeysStore = InstanceType<typeof AiKeysStore>;
