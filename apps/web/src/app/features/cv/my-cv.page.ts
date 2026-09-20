import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { CvStore } from '../../core/cv/cv.store';
import { RequestError } from '../../shared/ui/request-error';
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
  imports: [CvUpload, MatButtonModule, RequestError],
  providers: [CvStore],
  templateUrl: './my-cv.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyCvPage {
  private readonly store = inject(CvStore);

  protected readonly items = this.store.items;
  protected readonly loading = this.store.loading;
  protected readonly loaded = this.store.loaded;
  protected readonly isEmpty = this.store.isEmpty;
  protected readonly failure = this.store.failure;
  protected readonly uploading = this.store.uploading;
  protected readonly uploadPercent = this.store.uploadPercent;

  constructor() {
    void this.store.load();
  }

  /** El archivo ya pasó las comprobaciones locales; lo que diga la API manda igual. */
  protected upload(file: File): void {
    void this.store.upload(file);
  }

  /** "Reintentar" de la lista, que además reanuda la ventana de sondeo si alguna lectura sigue en curso. */
  protected retry(): void {
    void this.store.refresh();
  }
}
