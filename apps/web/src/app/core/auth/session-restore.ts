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

/** Rutas que se abren con sesión y sin ella; hoy solo la vista pública de una oferta (D9). */
const PUBLIC_PATH_PREFIXES = ['/oferta/'];

/**
 * `true` si el SPA arrancó en una ruta pública. Ahí NO se restaura la sesión al cargar: quien llega desde un chat no
 * tiene cookie de refresh, así que pagaría "Conectando…" y una llamada inútil —con la API lenta, hasta diez segundos
 * mirando una pantalla vacía— antes de ver la oferta, justo en la primera impresión que este change existe para cuidar.
 * La sesión se resuelve donde siempre: en el guard de la ruta a la que se navega después.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

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
    // En una ruta pública no se arranca nada: `authGuard` y `guestGuard` siguen llamando a `restore()`, así que salir
    // de la vista pública hacia cualquier otra ruta se comporta igual que siempre.
    if (isPublicPath(location.pathname)) {
      return;
    }
    void inject(SessionRestore).restore();
  });
}
