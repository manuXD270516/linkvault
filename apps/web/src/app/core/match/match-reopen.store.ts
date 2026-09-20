import { Injectable } from '@angular/core';
import type { MatchDialogData } from '../../features/match/match.dialog';

/**
 * Tras "Cambiar de CV" / "Dar permiso" el diálogo navega fuera y se cierra. Al volver a la lista, se reabre con los
 * mismos datos **sin** pedir análisis (spec web/cv-match).
 */
@Injectable({ providedIn: 'root' })
export class MatchReopenStore {
  private pending: MatchDialogData | null = null;

  remember(data: MatchDialogData): void {
    this.pending = data;
  }

  peek(): MatchDialogData | null {
    return this.pending;
  }

  consume(): MatchDialogData | null {
    const value = this.pending;
    this.pending = null;
    return value;
  }
}
