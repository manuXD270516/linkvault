import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { IMPORT_TEXT_MAX_LENGTH, type ImportLinksResponse } from '@linkvault/shared';
import { type RequestFailure, isApiFailure, toRequestFailure } from '../../core/api/api-error';
import { LinksStore } from '../../core/links/links.store';
import { RequestError } from '../../shared/ui/request-error';

/**
 * Importar pegando el chat donde circulan las ofertas (spec web/links). El cuadro lleva un contador que avisa antes de
 * enviar cuando el texto pasa del máximo, así que un texto demasiado largo no llega a la API; si aun así respondiera
 * `text_too_long`, el aviso es el mismo.
 *
 * Al terminar, el diálogo cambia el cuadro por el resumen y se queda abierto: la lista de detrás ya está actualizada
 * (`LinksStore.importText` recarga), y cerrar el diálogo no debería llevarse por delante el recuento.
 */
@Component({
  selector: 'lv-import-links-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    RequestError,
  ],
  templateUrl: './import-links.dialog.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportLinksDialog {
  private readonly store = inject(LinksStore);

  protected readonly text = signal('');
  protected readonly submitting = signal(false);
  protected readonly failure = signal<RequestFailure | null>(null);
  protected readonly summary = signal<ImportLinksResponse | null>(null);

  protected readonly length = computed(() => this.text().length);
  /** El texto no se recorta: sus espacios y saltos de línea son parte del chat y la API mide lo que se envía. */
  protected readonly tooLong = computed(
    () => this.length() > IMPORT_TEXT_MAX_LENGTH || isApiFailure(this.failure(), 400, 'text_too_long'),
  );
  protected readonly canImport = computed(
    () => this.text().trim().length > 0 && this.length() <= IMPORT_TEXT_MAX_LENGTH,
  );
  /** Ni guardadas, ni ya presentes, ni ilegibles: en ese texto no había ninguna oferta. */
  protected readonly nothingFound = computed(() => {
    const summary = this.summary();
    return (
      summary !== null &&
      summary.created === 0 &&
      summary.existing === 0 &&
      summary.unrecognized === 0
    );
  });

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value);
  }

  protected async submit(): Promise<void> {
    if (!this.canImport() || this.submitting()) {
      return;
    }
    this.submitting.set(true);
    this.failure.set(null);
    try {
      this.summary.set(await this.store.importText(this.text()));
    } catch (error: unknown) {
      this.failure.set(toRequestFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }
}
