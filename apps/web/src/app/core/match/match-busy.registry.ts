import { Injectable, computed, signal } from '@angular/core';

/**
 * Qué ofertas tienen un análisis de encaje en curso (spec web/cv-match / tarea 16.16).
 *
 * El `MatchStore` del diálogo se destruye al cerrar, pero el trabajo en el worker sigue: la tarjeta mantiene
 * `aria-busy` mientras este registro diga que el `linkId` está ocupado. Se limpia al terminar (o al reabrir y ver que
 * ya no corre).
 */
@Injectable({ providedIn: 'root' })
export class MatchBusyRegistry {
  private readonly busyIds = signal<ReadonlySet<string>>(new Set());

  readonly ids = this.busyIds.asReadonly();

  isBusy(linkId: string): boolean {
    return this.busyIds().has(linkId);
  }

  /** Señal derivada para una tarjeta concreta. */
  busyOf(linkId: () => string) {
    return computed(() => this.busyIds().has(linkId()));
  }

  setBusy(linkId: string, busy: boolean): void {
    this.busyIds.update((current) => {
      const next = new Set(current);
      if (busy) {
        next.add(linkId);
      } else {
        next.delete(linkId);
      }
      return next;
    });
  }
}
