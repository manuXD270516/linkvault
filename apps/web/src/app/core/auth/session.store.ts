import { computed, inject, Injector } from '@angular/core';
import { isAiConsentCurrent, type SessionResponse, type UserProfile } from '@linkvault/shared';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';
import { AuthApi } from './auth.api';

/**
 * Estado de la sesión en el SPA. `unknown` mientras no se ha intentado restaurar la sesión al cargar; `anonymous` sin
 * sesión. El access token vive solo aquí, en memoria (spec web/auth, "Token solo en memoria").
 */
export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

/**
 * Vigencia del consentimiento para IA externa, tal como la lee el diálogo de encaje (spec web/cv-match):
 * - `current`: activo y sobre el texto vigente;
 * - `outdated`: no activo, o activo sobre un texto ya no vigente (el interruptor **no** se apaga solo);
 * - `unknown`: todavía no se ha cargado el perfil, o la petición de volver a pedirlo falló.
 */
export type ConsentCurrency = 'current' | 'outdated' | 'unknown';

/** Cómo de fiable es el `aiConsent` del perfil en memoria. */
export type ConsentLoadStatus = 'unknown' | 'ready' | 'failed';

export interface SessionState {
  accessToken: string | null;
  /** Instante (ms desde epoch) en que caduca el access token según `expiresIn`. */
  expiresAt: number | null;
  user: UserProfile | null;
  status: SessionStatus;
  /**
   * `ready` tras login/registro/refresh/`setUser`/`reloadConsent` ok; `failed` si "Comprobar de nuevo" falló;
   * `unknown` al arrancar o tras `clear`.
   */
  consentLoadStatus: ConsentLoadStatus;
  /** `true` mientras `reloadConsent` espera a la API. */
  consentLoading: boolean;
}

const initialState: SessionState = {
  accessToken: null,
  expiresAt: null,
  user: null,
  status: 'unknown',
  consentLoadStatus: 'unknown',
  consentLoading: false,
};

export const SessionStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ status, user, consentLoadStatus }) => ({
    isAuthenticated: computed(() => status() === 'authenticated'),
    /**
     * `true` mientras la sesión autenticada tenga `emailVerified` en `false` (banner de verificación, ADR-034).
     */
    needsEmailVerification: computed(() => {
      const profile = user();
      return (
        status() === 'authenticated' && profile !== null && profile.emailVerified === false
      );
    }),
    /**
     * Tres valores: vigente, no vigente o desconocido. No muta `externalProviders` cuando las versiones difieren —solo
     * reporta `outdated`.
     */
    consentIsCurrent: computed((): ConsentCurrency => {
      if (consentLoadStatus() !== 'ready') {
        return 'unknown';
      }
      const profile = user();
      if (profile === null) {
        return 'unknown';
      }
      return isAiConsentCurrent(profile.aiConsent) ? 'current' : 'outdated';
    }),
  })),
  withMethods((store, injector = inject(Injector)) => ({
    /** Guarda la sesión devuelta por registro, login o refresh. */
    setSession(session: SessionResponse, now: number = Date.now()): void {
      patchState(store, {
        accessToken: session.accessToken,
        expiresAt: now + session.expiresIn * 1000,
        user: session.user,
        status: 'authenticated',
        consentLoadStatus: 'ready',
        consentLoading: false,
      });
    },
    /** Sustituye el perfil (p. ej. tras `PATCH /api/users/me`) sin tocar el token ni apagar el consentimiento. */
    setUser(user: UserProfile): void {
      patchState(store, {
        user,
        consentLoadStatus: 'ready',
        consentLoading: false,
      });
    },
    /** Olvida la sesión local y deja el estado en `anonymous`. */
    clear(): void {
      patchState(store, {
        accessToken: null,
        expiresAt: null,
        user: null,
        status: 'anonymous',
        consentLoadStatus: 'unknown',
        consentLoading: false,
      });
    },
    /**
     * "Comprobar de nuevo": vuelve a pedir el perfil. Mientras corre, `consentIsCurrent` es `unknown`; si falla,
     * sigue `unknown` (`failed`); si responde, queda `current` u `outdated` según el texto vigente.
     *
     * `AuthApi` se resuelve al llamar (no al construir el store) para no cerrar el ciclo `SessionStore` ↔ `AuthApi`.
     */
    async reloadConsent(): Promise<void> {
      patchState(store, {
        consentLoadStatus: 'unknown',
        consentLoading: true,
      });
      try {
        const user = await injector.get(AuthApi).getProfile();
        // `getProfile` ya llama a `setUser`; se refuerza por si el perfil no cambió la marca de carga.
        patchState(store, {
          user,
          consentLoadStatus: 'ready',
          consentLoading: false,
        });
      } catch {
        patchState(store, {
          consentLoadStatus: 'failed',
          consentLoading: false,
        });
      }
    },
  })),
);

export type SessionStore = InstanceType<typeof SessionStore>;
