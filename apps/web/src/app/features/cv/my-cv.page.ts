import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { isAiConsentCurrent, type CvDocument } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';
import { SessionStore } from '../../core/auth/session.store';
import { CvStore } from '../../core/cv/cv.store';
import { confirmWith } from '../../shared/ui/confirm.dialog';
import { RequestError } from '../../shared/ui/request-error';
import { CvCard } from './cv-card.component';
import {
  CvTextPreviewDialog,
  type CvTextPreviewDialogData,
  type CvTextPreviewResult,
} from './cv-text-preview.dialog';
import { CvUpload } from './cv-upload.component';

/**
 * `/mi-cv` (D13, ADR-030 §12, spec web/cv): CV guardados, privacidad honesta atada a la vigencia del permiso, y
 * borrado que nombra cuántos análisis se llevan.
 */
@Component({
  selector: 'lv-my-cv-page',
  imports: [CvCard, CvUpload, MatButtonModule, RequestError, RouterLink],
  providers: [CvStore],
  templateUrl: './my-cv.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyCvPage {
  private readonly store = inject(CvStore);
  private readonly session = inject(SessionStore);
  private readonly dialog = inject(MatDialog);

  protected readonly items = this.store.items;
  protected readonly loading = this.store.loading;
  protected readonly loaded = this.store.loaded;
  protected readonly isEmpty = this.store.isEmpty;
  protected readonly failure = this.store.failure;
  protected readonly uploading = this.store.uploading;
  protected readonly uploadPercent = this.store.uploadPercent;
  protected readonly uploadFailure = this.store.uploadFailure;
  protected readonly actionFailure = this.store.actionFailure;
  protected readonly stalled = this.store.stalled;

  protected readonly busy = signal(false);
  protected readonly goneNotice = signal(false);

  /**
   * Estado del permiso para la frase adicional: solo con perfil cargado (`ready`). Nunca dos frases a la vez.
   * - `none`: sin permiso (nunca dado o retirado)
   * - `current`: vigente
   * - `outdated`: dado sobre texto anterior
   * - `unknown`: aún no se conoce → solo la línea base
   */
  protected readonly consentPhrase = computed((): 'none' | 'current' | 'outdated' | 'unknown' => {
    if (this.session.consentLoadStatus() !== 'ready') {
      return 'unknown';
    }
    const profile = this.session.user();
    if (profile === null) {
      return 'unknown';
    }
    if (isAiConsentCurrent(profile.aiConsent)) {
      return 'current';
    }
    if (
      profile.aiConsent.externalProviders &&
      profile.aiConsent.textVersion !== null &&
      profile.aiConsent.textVersion !== profile.aiConsent.currentTextVersion
    ) {
      return 'outdated';
    }
    return 'none';
  });

  constructor() {
    void this.store.load();
  }

  protected upload(file: File): void {
    void this.store.upload(file);
  }

  protected hasOtherExtracted(item: CvDocument): boolean {
    const extracted = this.store.newestExtracted();
    return extracted !== null && extracted.id !== item.id;
  }

  protected useThis(item: CvDocument): void {
    void this.run(() => this.store.setDefault(item.id));
  }

  protected useExtracted(): void {
    const extracted = this.store.newestExtracted();
    if (extracted !== null) {
      void this.run(() => this.store.setDefault(extracted.id));
    }
  }

  protected viewText(item: CvDocument): void {
    this.goneNotice.set(false);
    const dialogRef = this.dialog.open<
      CvTextPreviewDialog,
      CvTextPreviewDialogData,
      CvTextPreviewResult
    >(CvTextPreviewDialog, { data: { cvId: item.id }, width: 'min(640px, 95vw)' });
    void firstValueFrom(dialogRef.afterClosed()).then((result) => {
      if (result === 'gone') {
        this.goneNotice.set(true);
        void this.store.refresh();
      }
    });
  }

  protected remove(item: CvDocument): void {
    void this.run(async () => {
      const analyses = item.matchAnalysesCount;
      const analysesLine =
        analyses > 0
          ? $localize`:@@cv.delete.analyses:También se borrarán los ${analyses}:COUNT: análisis de encaje que hiciste con este CV.`
          : '';
      const base = item.isDefault
        ? $localize`:@@cv.delete.messageDefault:¿Eliminar ${item.fileName}:NAME:? El archivo se borra y no se puede recuperar. Pasará a usarse tu CV más reciente.`
        : $localize`:@@cv.delete.message:¿Eliminar ${item.fileName}:NAME:? El archivo se borra y no se puede recuperar.`;
      const confirmed = await confirmWith(this.dialog, {
        title: $localize`:@@cv.delete.title:Eliminar este CV`,
        message: analysesLine === '' ? base : `${base} ${analysesLine}`,
        confirmLabel: $localize`:@@cv.delete.confirm:Eliminar`,
      });
      if (confirmed) {
        await this.store.remove(item.id);
      }
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await action();
    } finally {
      this.busy.set(false);
    }
  }

  protected retry(): void {
    void this.store.refresh();
  }
}
