import { Injectable, computed, inject, signal } from '@angular/core';
import type { CapabilitiesResponse } from '@linkvault/shared';
import { firstValueFrom, timeout } from 'rxjs';
import { CapabilitiesApi } from './capabilities.api';

/** Plazo de la petición de capacidades (D5, B7): al vencer, el store falla abierto y cancela la petición. */
export const CAPABILITIES_TIMEOUT_MS = 5000;

export type CapabilitiesState = 'loading' | 'ready' | 'failed';

/**
 * Capacidades del despliegue (spec web/shell, D4 y D5 de web-shell-capabilities). Una sola petición por carga de la
 * aplicación: quien llame mientras está en vuelo recibe la misma promesa, y tras `ready` o `failed` no se repite. No
 * depende del usuario, así que no se borra al cerrar sesión.
 *
 * - `loading`: las entradas condicionales no se muestran y las páginas enseñan un estado neutro.
 * - `ready`: cada capacidad manda.
 * - `failed` (red, 5xx, cuerpo inválido o sin respuesta en 5 s): se muestra todo, como antes de existir este contrato;
 *   cada página conserva su `503` honesto.
 */
@Injectable({ providedIn: 'root' })
export class CapabilitiesStore {
  private readonly api = inject(CapabilitiesApi);

  private readonly stateSignal = signal<CapabilitiesState>('loading');
  private readonly capabilities = signal<CapabilitiesResponse | null>(null);
  private pending: Promise<void> | null = null;

  readonly state = this.stateSignal.asReadonly();

  /** Entrada visible: desconocido oculta, fallo abre. */
  readonly showSearch = computed(() => this.visible('search'));
  readonly showDiscovery = computed(() => this.visible('discovery'));
  /** Solo `true` con la respuesta recibida y la capacidad apagada. */
  readonly searchOff = computed(() => this.off('search'));
  readonly discoveryOff = computed(() => this.off('discovery'));

  ensureLoaded(): Promise<void> {
    this.pending ??= this.load();
    return this.pending;
  }

  private async load(): Promise<void> {
    try {
      // `timeout` se desuscribe de la petición al vencer: HttpClient la cancela y no queda una respuesta tardía.
      const response = await firstValueFrom(
        this.api.get().pipe(timeout(CAPABILITIES_TIMEOUT_MS)),
      );
      this.capabilities.set(response);
      this.stateSignal.set('ready');
    } catch {
      this.stateSignal.set('failed');
    }
  }

  private visible(key: keyof CapabilitiesResponse): boolean {
    const state = this.stateSignal();
    if (state === 'loading') {
      return false;
    }
    return state === 'failed' || this.capabilities()?.[key] === true;
  }

  private off(key: keyof CapabilitiesResponse): boolean {
    return (
      this.stateSignal() === 'ready' && this.capabilities()?.[key] === false
    );
  }
}
