import { computed } from '@angular/core';
import type { SessionResponse, UserProfile } from '@linkvault/shared';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';

/**
 * Estado de la sesión en el SPA. `unknown` mientras no se ha intentado restaurar la sesión al cargar; `anonymous` sin
 * sesión. El access token vive solo aquí, en memoria (spec web/auth, "Token solo en memoria").
 */
export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous';

export interface SessionState {
  accessToken: string | null;
  /** Instante (ms desde epoch) en que caduca el access token según `expiresIn`. */
  expiresAt: number | null;
  user: UserProfile | null;
  status: SessionStatus;
}

const initialState: SessionState = {
  accessToken: null,
  expiresAt: null,
  user: null,
  status: 'unknown',
};

export const SessionStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ status }) => ({
    isAuthenticated: computed(() => status() === 'authenticated'),
  })),
  withMethods((store) => ({
    /** Guarda la sesión devuelta por registro, login o refresh. */
    setSession(session: SessionResponse, now: number = Date.now()): void {
      patchState(store, {
        accessToken: session.accessToken,
        expiresAt: now + session.expiresIn * 1000,
        user: session.user,
        status: 'authenticated',
      });
    },
    /** Sustituye el perfil (p. ej. tras `PATCH /api/users/me`) sin tocar el token. */
    setUser(user: UserProfile): void {
      patchState(store, { user });
    },
    /** Olvida la sesión local y deja el estado en `anonymous`. */
    clear(): void {
      patchState(store, {
        accessToken: null,
        expiresAt: null,
        user: null,
        status: 'anonymous',
      });
    },
  })),
);

export type SessionStore = InstanceType<typeof SessionStore>;
