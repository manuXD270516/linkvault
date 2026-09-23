import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { JobLinkSummary, ReopenLinkRequest } from '@linkvault/shared';
import { type RequestFailure, toRequestFailure } from '../../core/api/api-error';
import { LinksStore } from '../../core/links/links.store';
import { RequestError } from '../../shared/ui/request-error';
import { localDay } from '../applications/applied-date-question.component';

/** El link cerrado que pide una fecha (o limpiar caducidad) antes de reabrir. */
export interface ReopenExpiresDialogData {
  link: JobLinkSummary;
}

/**
 * Calendar / `expiresAt` pasado (ADR-041): el API respondió `400` nombrando `expiresAt`. Aquí se elige un día futuro
 * `YYYY-MM-DD` o se limpia la caducidad (`null`) y se reintenta el reopen. Copy honesta: las postulaciones `expired` no
 * se reabren solas (D4).
 */
@Component({
  selector: 'lv-reopen-expires-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, RequestError],
  templateUrl: './reopen-expires.dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReopenExpiresDialog {
  private readonly store = inject(LinksStore);
  private readonly dialogRef =
    inject<MatDialogRef<ReopenExpiresDialog, JobLinkSummary | undefined>>(MatDialogRef);
  private readonly link = inject<ReopenExpiresDialogData>(MAT_DIALOG_DATA).link;

  /** Día local de hoy: el selector no admite caducidades ya pasadas (mismo contrato UTC del API). */
  protected readonly today = localDay(new Date());
  /** Vacío al abrir: la caducidad previa podía estar en el pasado y no vale para reenviar. */
  protected readonly expiresAt = signal('');
  protected readonly submitting = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);

  /** Fecha vacía o futura; pasado no se puede enviar (el API lo rechazaría otra vez). */
  protected readonly canSubmitDate = computed(() => {
    const day = this.expiresAt().trim();
    return day.length > 0 && day >= this.today && !this.submitting();
  });

  protected onExpiresAt(event: Event): void {
    this.expiresAt.set((event.target as HTMLInputElement).value);
  }

  /** Reabre con la fecha elegida (`YYYY-MM-DD`). */
  protected async submitDate(): Promise<void> {
    if (!this.canSubmitDate()) {
      return;
    }
    await this.submit({ expiresAt: this.expiresAt().trim() });
  }

  /** Reabre quitando la caducidad (`expiresAt: null`). */
  protected async clearExpires(): Promise<void> {
    if (this.submitting()) {
      return;
    }
    await this.submit({ expiresAt: null });
  }

  private async submit(body: ReopenLinkRequest): Promise<void> {
    this.submitting.set(true);
    this.failure.set(null);
    this.dialogRef.disableClose = true;
    try {
      this.dialogRef.close(await this.store.reopen(this.link.id, body));
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.submitting.set(false);
      this.dialogRef.disableClose = false;
    }
  }
}
