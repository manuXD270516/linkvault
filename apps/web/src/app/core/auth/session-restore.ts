import {
  type EnvironmentProviders,
  Injectable,
  inject,
  provideAppInitializer,
} from '@angular/core';
import { AuthApi } from './auth.api';
import { SessionStore } from './session.store';

/** Tiempo máximo del refresh inicial al cargar el SPA (spec web/auth, "Restauración de la sesión al cargar"). */
export const SESSION_RESTORE_TIMEOUT_MS = 10_000;

/**
 * Restaura la sesión con un refresh al cargar. Se ejecuta una sola vez: el initializer la arranca y los guards la
 * esperan antes de resolver la primera navegación. Si el refresh falla o se agota el tiempo, aborta la cadena (sin
 * reintentos ni logout) y deja la sesión en `anonymous`.
 */
@Injectable({ providedIn: 'root' })
export class SessionRestore {
  private readonly authApi = inject(AuthApi);
  private readonly store = inject(SessionStore);
  private restoring: Promise<void> | null = null;

  restore(): Promise<void> {
    this.restoring ??= this.run();
    return this.restoring;
  }

  private async run(): Promise<void> {
    if (this.store.status() !== 'unknown') {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SESSION_RESTORE_TIMEOUT_MS);
    try {
      await this.authApi.refresh(controller.signal);
    } catch {
      // Sin sesión que restaurar, API caída o tiempo agotado: se continúa como invitado.
      this.store.clear();
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Arranca la restauración sin bloquear el arranque, para que la raíz pueda mostrar "Conectando…" (traducible) mientras
 * los guards esperan el resultado.
 */
export function provideSessionRestore(): EnvironmentProviders {
  return provideAppInitializer(() => {
    void inject(SessionRestore).restore();
  });
}
