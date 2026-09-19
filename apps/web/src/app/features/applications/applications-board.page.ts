import { CdkDrag, type CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Application, ApplicationStatus } from '@linkvault/shared';
import type { RequestFailure } from '../../core/api/api-error';
import { ApplicationsStore } from '../../core/applications/applications.store';
import { RequestError } from '../../shared/ui/request-error';
import { ApplicationCard } from './application-card.component';
import { ApplicationMoves, type MoveOutcome } from './application-moves';
import {
  BOARD_COLUMNS,
  type BoardColumnId,
  columnOf,
  columnTitle,
} from './application-status.labels';

/** Estado al que lleva soltar en cada columna; "Cerradas" pregunta cuál de los cierres. */
const COLUMN_TARGET: Record<Exclude<BoardColumnId, 'closed'>, ApplicationStatus> = {
  interest: 'interested',
  applied: 'applied',
  in_process: 'in_process',
  offer: 'offer',
  accepted: 'accepted',
};

/**
 * Tablero de postulaciones (`/postulaciones`, D11). Las columnas salen del store en cada cambio, así que una tarjeta
 * solo cambia de columna cuando la API confirma: el arrastre no toca los datos, y si el cambio falla o se cancela, la
 * tarjeta vuelve sola a donde estaba. "Mover a…" es la misma operación sin ratón.
 */
@Component({
  selector: 'lv-applications-board-page',
  imports: [ApplicationCard, CdkDrag, CdkDropList, CdkDropListGroup, RequestError, RouterLink],
  templateUrl: './applications-board.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationsBoardPage {
  private readonly store = inject(ApplicationsStore);
  private readonly moves = inject(ApplicationMoves);

  protected readonly loaded = this.store.boardLoaded;
  protected readonly loadFailure = this.store.boardFailure;
  protected readonly isEmpty = computed(
    () => this.store.boardLoaded() && this.store.applications().length === 0,
  );

  protected readonly columns = computed(() => {
    const applications = this.store.applications();
    return BOARD_COLUMNS.map((id) => ({
      id,
      title: columnTitle(id),
      items: applications.filter((application) => columnOf(application.status) === id),
    }));
  });

  /** Un movimiento a la vez: el segundo usaría una `version` que el primero está a punto de cambiar. */
  protected readonly moving = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);
  protected readonly conflict = signal(false);

  constructor() {
    void this.store.loadBoard();
  }

  protected async dropped(event: CdkDragDrop<BoardColumnId, BoardColumnId, Application>): Promise<void> {
    const column = event.container.data;
    const application = event.item.data;
    if (column === columnOf(application.status)) {
      return;
    }
    await this.moveToColumn(application, column);
  }

  protected async moveTo(application: Application, target: ApplicationStatus): Promise<void> {
    await this.run(() => this.moves.move(application, target));
  }

  private async moveToColumn(application: Application, column: BoardColumnId): Promise<void> {
    await this.run(async () => {
      if (column !== 'closed') {
        return this.moves.move(application, COLUMN_TARGET[column]);
      }
      const closing = await this.moves.chooseClosing();
      return closing === null ? { kind: 'cancelled' } : this.moves.move(application, closing);
    });
  }

  private async run(action: () => Promise<MoveOutcome>): Promise<void> {
    if (this.moving()) {
      return;
    }
    this.moving.set(true);
    this.failure.set(null);
    this.conflict.set(false);
    try {
      const outcome = await action();
      if (outcome.kind === 'failed') {
        this.failure.set(outcome.failure);
      } else if (outcome.kind === 'conflict') {
        this.conflict.set(true);
      }
    } finally {
      this.moving.set(false);
    }
  }
}
