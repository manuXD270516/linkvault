import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { type RequestFailure, hasApiErrorCode, toRequestFailure } from '../../core/api/api-error';
import { CvApi } from '../../core/cv/cv.api';
import { RequestError } from '../../shared/ui/request-error';

/** El CV cuyo texto se mira; el diálogo no necesita nada más porque el texto lo pide él. */
export interface CvTextPreviewDialogData {
  cvId: string;
}

/** `'gone'` si el CV ya no existe (lo borraron en otra pestaña): quien lo abrió lo dice y recarga la lista. */
export type CvTextPreviewResult = 'gone' | undefined;

/** Qué se dice cuando la vista previa no se puede mostrar; los dos ofrecen "Reintentar" (D13). */
type PreviewError = { kind: 'tooMany'; failure: RequestFailure } | { kind: 'failed' };

/**
 * "Ver lo que leímos" (D6, D13, spec web/cv): el principio del texto que se extrajo, en un bloque desplazable, para
 * comprobar que la lectura sirve. Un PDF a dos columnas se lee entrelazado y da miles de caracteres ilegibles; sin
 * esto, la primera persona en enterarse sería la que recibiera un análisis absurdo mucho después.
 *
 * **No ofrece copiar, descargar ni compartir**, y el texto no queda en la pantalla al cerrarlo: es para mirar, no para
 * sacar. El encabezado vale para los dos formatos, porque "sube el PDF original" no le sirve a quien subió un DOCX.
 */
@Component({
  selector: 'lv-cv-text-preview-dialog',
  imports: [MatButtonModule, MatDialogModule, RequestError],
  templateUrl: './cv-text-preview.dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CvTextPreviewDialog {
  private readonly api = inject(CvApi);
  private readonly dialogRef =
    inject<MatDialogRef<CvTextPreviewDialog, CvTextPreviewResult>>(MatDialogRef);
  private readonly data = inject<CvTextPreviewDialogData>(MAT_DIALOG_DATA);

  protected readonly loading = signal(true);
  /** Lo leído del CV; `null` mientras no haya llegado nada. */
  protected readonly text = signal<string | null>(null);
  private readonly failure = signal<RequestFailure | null>(null);

  protected readonly error = computed((): PreviewError | null => {
    const failure = this.failure();
    if (failure === null) {
      return null;
    }
    return failure.kind === 'api' && failure.status === 429 && failure.code === 'too_many_attempts'
      ? { kind: 'tooMany', failure }
      : { kind: 'failed' };
  });

  constructor() {
    void this.load();
  }

  /**
   * Pide el trozo de texto. Un `404` es el caso normal de haberlo borrado en otra pestaña: el diálogo se cierra
   * diciendo `gone` y la lista se recarga fuera. Lo demás se explica aquí, con "Reintentar".
   *
   * Una respuesta sin texto —el CV dejó de estar `extracted` entre que se pintó la lista y se pulsó— se trata como un
   * fallo genérico: un diálogo en blanco no se puede interpretar.
   */
  protected async load(): Promise<void> {
    this.loading.set(true);
    this.failure.set(null);
    try {
      const preview = await this.api.textPreview(this.data.cvId);
      if (preview.text === '') {
        this.failure.set({ kind: 'unknown' });
        return;
      }
      this.text.set(preview.text);
    } catch (error: unknown) {
      if (hasApiErrorCode(error, 404, 'cv_not_found')) {
        this.dialogRef.close('gone');
        return;
      }
      this.failure.set(toRequestFailure(error));
    } finally {
      this.loading.set(false);
    }
  }
}
