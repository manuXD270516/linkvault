import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import type { CvDocument } from '@linkvault/shared';
import { firstValueFrom } from 'rxjs';
import { CvStore } from '../../core/cv/cv.store';
import { RequestError } from '../../shared/ui/request-error';
import { CvCard } from './cv-card.component';
import {
  CvTextPreviewDialog,
  type CvTextPreviewDialogData,
  type CvTextPreviewResult,
} from './cv-text-preview.dialog';
import { CvUpload } from './cv-upload.component';

/**
 * `/mi-cv` (D13, spec web/cv): los CV guardados de la persona, con subir, marcar cuál se comparará con las vacantes,
 * ver lo que se leyó y eliminar.
 *
 * La pantalla **no ofrece descargar** el archivo, porque la API no tiene ninguna ruta que lo devuelva (ADR-028 §5), y
 * dice "CV guardado" en todas partes: el número de versión vive en el contrato y en la base, no aquí.
 *
 * El store lo provee la página y no la raíz, para que salir de la pantalla se lleve el sondeo de las lecturas.
 */
@Component({
  selector: 'lv-my-cv-page',
  imports: [CvCard, CvUpload, MatButtonModule, RequestError],
  providers: [CvStore],
  templateUrl: './my-cv.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyCvPage {
  private readonly store = inject(CvStore);
  private readonly dialog = inject(MatDialog);

  protected readonly items = this.store.items;
  protected readonly loading = this.store.loading;
  protected readonly loaded = this.store.loaded;
  protected readonly isEmpty = this.store.isEmpty;
  protected readonly failure = this.store.failure;
  protected readonly uploading = this.store.uploading;
  protected readonly uploadPercent = this.store.uploadPercent;
  protected readonly actionFailure = this.store.actionFailure;

  /** `true` mientras hay una acción en curso: marcar o eliminar no se pueden pulsar dos veces. */
  protected readonly busy = signal(false);
  /** `true` tras intentar ver el texto de un CV que ya no está; se borra en cuanto se vuelve a mirar otro. */
  protected readonly goneNotice = signal(false);

  constructor() {
    void this.store.load();
  }

  /** El archivo ya pasó las comprobaciones locales; lo que diga la API manda igual. */
  protected upload(file: File): void {
    void this.store.upload(file);
  }

  /** El aviso del marcado en `failed` solo ofrece su acción si hay otro CV que sí se pudo leer. */
  protected hasOtherExtracted(item: CvDocument): boolean {
    const extracted = this.store.newestExtracted();
    return extracted !== null && extracted.id !== item.id;
  }

  protected useThis(item: CvDocument): void {
    void this.run(() => this.store.setDefault(item.id));
  }

  /** "Usar el que sí se leyó": marca el más reciente de los que tienen texto. */
  protected useExtracted(): void {
    const extracted = this.store.newestExtracted();
    if (extracted !== null) {
      void this.run(() => this.store.setDefault(extracted.id));
    }
  }

  /**
   * Abre la vista previa del texto. Si el CV ya no existe —lo borraron en otra pestaña—, el diálogo se cierra, se dice
   * "Este CV ya no está" y la lista se recarga.
   */
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
    void this.run(() => this.store.remove(item.id));
  }

  /** Mientras una acción está en curso, las demás no responden. */
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

  /** "Reintentar" de la lista, que además reanuda la ventana de sondeo si alguna lectura sigue en curso. */
  protected retry(): void {
    void this.store.refresh();
  }
}
