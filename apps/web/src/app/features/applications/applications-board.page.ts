import { CdkDrag, type CdkDragDrop, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { Application, ApplicationStatus } from '@linkvault/shared';
import type { RequestFailure } from '../../core/api/api-error';
import { ApplicationsStore } from '../../core/applications/applications.store';
import { RequestError } from '../../shared/ui/request-error';
import { ApplicationCard } from './application-card.component';
import { ApplicationDetailDialog, type ApplicationDetailDialogData } from './application-detail.dialog';
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
 *
 * Query `applicationId` + `linkId` (desde insights stale): abre el detalle al cargar.
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
  private readonly dialog = inject(MatDialog);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

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
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    await this.store.loadBoard();
    this.openDetailFromQuery();
  }

  /** Abre el panel si insights (u otro) llegó con `applicationId` + `linkId`, y limpia la query. */
  private openDetailFromQuery(): void {
    const params = this.route.snapshot.queryParamMap;
    const applicationId = params.get('applicationId');
    const linkId = params.get('linkId');
    if (applicationId === null || linkId === null) {
      return;
    }
    const application = this.store.byLinkId()[linkId];
    if (application !== undefined && application.id === applicationId) {
      this.openDetail(application);
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true,
    });
  }

  /** El panel se abre a la derecha, a toda la altura: el tablero sigue a la vista detrás. */
  protected openDetail(application: Application): void {
    this.dialog.open<ApplicationDetailDialog, ApplicationDetailDialogData>(ApplicationDetailDialog, {
      data: { id: application.id, linkId: application.linkId },
      position: { right: '0', top: '0' },
      height: '100%',
      width: 'min(32rem, 100vw)',
      maxWidth: '100vw',
    });
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
