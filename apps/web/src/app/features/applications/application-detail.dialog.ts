import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { type MatSlideToggleChange, MatSlideToggleModule } from '@angular/material/slide-toggle';
import type { ApplicationEvent, ApplicationStatus } from '@linkvault/shared';
import { type RequestFailure, toRequestFailure } from '../../core/api/api-error';
import { type ApplicationRef, ApplicationsStore } from '../../core/applications/applications.store';
import { confirmWith } from '../../shared/ui/confirm.dialog';
import { RequestError } from '../../shared/ui/request-error';
import { linkLabel, platformName } from '../links/link-preview';
import { ApplicationMoves } from './application-moves';
import { MOVABLE_STATUSES, statusLabel } from './application-status.labels';
import { AppliedAgo } from './applied-ago.component';
import { shareScopeText, shareToggleLabel } from './share-scope';

/** La postulación que se abre: el panel la lee del store, así que refleja cualquier cambio sin recargar. */
export type ApplicationDetailDialogData = ApplicationRef;

/** Longitud máxima de las notas; repite `APPLICATION_NOTES_MAX_LENGTH` de `@linkvault/shared` sin arrastrar zod. */
const NOTES_MAX_LENGTH = 2000;

/**
 * Panel lateral de una postulación (D11, spec web/applications "Detalle, historial, notas y compartir" y "Dejar de
 * seguir desde el panel"): la oferta, el estado y la etapa editables, el historial, las notas, el interruptor de
 * compartir con lo que verá el grupo y "Dejar de seguir".
 *
 * Si la postulación deja de existir (se dejó de seguir aquí o en otra pestaña), el store la quita y el panel se cierra
 * solo, sin error.
 */
@Component({
  selector: 'lv-application-detail-dialog',
  imports: [
    AppliedAgo,
    DatePipe,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatMenuModule,
    MatSlideToggleModule,
    RequestError,
  ],
  templateUrl: './application-detail.dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationDetailDialog {
  private readonly store = inject(ApplicationsStore);
  private readonly moves = inject(ApplicationMoves);
  private readonly dialog = inject(MatDialog);
  private readonly dialogRef = inject<MatDialogRef<ApplicationDetailDialog, void>>(MatDialogRef);
  private readonly ref = inject<ApplicationDetailDialogData>(MAT_DIALOG_DATA);

  protected readonly application = computed(() => {
    const application = this.store.byLinkId()[this.ref.linkId];
    return application?.id === this.ref.id ? application : null;
  });

  protected readonly headline = computed(() => {
    const link = this.application()?.link;
    return link === undefined ? '' : (link.title ?? linkLabel(link.displayUrl));
  });
  protected readonly platform = computed(() => {
    const link = this.application()?.link;
    return link === undefined ? '' : platformName(link.platform);
  });
  protected readonly status = computed(() => {
    const application = this.application();
    return application === null ? '' : statusLabel(application.status);
  });
  protected readonly stage = computed(() => {
    const application = this.application();
    return application?.status === 'in_process' ? (application.stageLabel ?? null) : null;
  });
  protected readonly targets = computed(() =>
    MOVABLE_STATUSES.filter((status) => status !== this.application()?.status).map((status) => ({
      status,
      label: statusLabel(status),
    })),
  );

  protected readonly events = signal<ApplicationEvent[] | null>(null);
  protected readonly timelineFailure = signal<RequestFailure | null>(null);

  protected readonly notesMaxLength = NOTES_MAX_LENGTH;
  /** Lo escrito: se conserva si guardar falla (spec "Nota que no se guardó"). */
  protected readonly notes = signal(this.store.byLinkId()[this.ref.linkId]?.notes ?? '');
  protected readonly notesSaved = signal(false);
  protected readonly notesFailure = signal<RequestFailure | null>(null);

  protected readonly shareLabel = shareToggleLabel();
  protected readonly shareScope = shareScopeText();
  protected readonly shareFailure = signal<RequestFailure | null>(null);

  protected readonly moveFailure = signal<RequestFailure | null>(null);
  protected readonly conflict = signal(false);

  /** Una petición a la vez sobre esta postulación; "Dejar de seguir" en curso bloquea todo. */
  protected readonly working = signal(false);
  protected readonly untracking = signal(false);

  constructor() {
    effect(() => {
      if (this.application() === null) {
        untracked(() => this.dialogRef.close());
      }
    });
    void this.loadTimeline();
  }

  protected rowLabel(event: ApplicationEvent): string {
    const label = statusLabel(event.to);
    return event.to === 'in_process' && event.stageLabel !== undefined
      ? `${label} · ${event.stageLabel}`
      : label;
  }

  protected onNotes(event: Event): void {
    this.notes.set((event.target as HTMLTextAreaElement).value);
    this.notesSaved.set(false);
  }

  protected async move(target: ApplicationStatus): Promise<void> {
    const application = this.application();
    if (application === null) {
      return;
    }
    await this.run(async () => {
      this.moveFailure.set(null);
      this.conflict.set(false);
      const outcome = await this.moves.move(application, target);
      if (outcome.kind === 'moved') {
        await this.loadTimeline();
      } else if (outcome.kind === 'conflict') {
        this.conflict.set(true);
      } else if (outcome.kind === 'failed') {
        this.moveFailure.set(outcome.failure);
      }
    });
  }

  /** Cambiar la etapa es entrar otra vez en "En proceso" con otra etapa: un cambio con su evento (D2). */
  protected async editStage(): Promise<void> {
    await this.move('in_process');
  }

  protected async saveNotes(): Promise<void> {
    await this.run(async () => {
      this.notesFailure.set(null);
      this.notesSaved.set(false);
      try {
        const updated = await this.store.update(this.ref, { notes: this.notes() });
        this.notesSaved.set(updated !== null);
      } catch (error: unknown) {
        this.notesFailure.set(toRequestFailure(error));
      }
    });
  }

  /** Si falla, el interruptor vuelve a como estaba: lo que manda es la visibilidad que tiene la postulación. */
  protected async toggleShare(change: MatSlideToggleChange): Promise<void> {
    await this.run(async () => {
      this.shareFailure.set(null);
      try {
        await this.store.update(this.ref, { visibility: change.checked ? 'group' : 'private' });
      } catch (error: unknown) {
        change.source.checked = !change.checked;
        this.shareFailure.set(toRequestFailure(error));
      }
    });
  }

  /**
   * Confirmación y borrado. El botón queda deshabilitado mientras la petición está en curso, así que un doble clic no
   * dispara dos borrados; un `404` ya es el resultado pedido (critic 7). Al quitarla del store, el panel se cierra.
   */
  protected async untrack(): Promise<void> {
    if (this.untracking()) {
      return;
    }
    this.untracking.set(true);
    try {
      const confirmed = await confirmWith(this.dialog, {
        title: $localize`:@@applications.untrack.title:Dejar de seguir`,
        message: $localize`:@@applications.untrack.message:Dejarás de seguir esta oferta: se borrarán tu estado, tus notas y tu historial de esta oferta. Tus grupos dejarán de verte en ella. No se puede deshacer.`,
        confirmLabel: $localize`:@@applications.untrack.confirm:Dejar de seguir`,
      });
      if (!confirmed) {
        return;
      }
      this.moveFailure.set(null);
      await this.store.untrack(this.ref);
    } catch (error: unknown) {
      this.moveFailure.set(toRequestFailure(error));
    } finally {
      this.untracking.set(false);
    }
  }

  private async loadTimeline(): Promise<void> {
    this.timelineFailure.set(null);
    try {
      const events = await this.store.timeline(this.ref);
      if (events !== null) {
        this.events.set(events);
      }
    } catch (error: unknown) {
      this.timelineFailure.set(toRequestFailure(error));
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.working() || this.untracking()) {
      return;
    }
    this.working.set(true);
    try {
      await action();
    } finally {
      this.working.set(false);
    }
  }
}
