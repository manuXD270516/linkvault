import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { CV_FILE_TYPES, CV_MAX_FILE_BYTES } from '@linkvault/shared';
import { type RequestFailure, isApiFailure } from '../../core/api/api-error';
import { RequestError } from '../../shared/ui/request-error';

/**
 * Lo que el selector de archivos acepta: las **extensiones y los MIME** de los dos formatos. Con los MIME, el selector
 * de un móvil deja de enseñar los documentos en gris; con las extensiones, el de un escritorio los reconoce igual
 * (business 10 de la iteración 1).
 */
export const CV_UPLOAD_ACCEPT = Object.values(CV_FILE_TYPES)
  .flatMap((type) => [type.extension, type.mimeType])
  .join(',');

const CV_EXTENSIONS = Object.values(CV_FILE_TYPES).map((type) => type.extension);

/** Qué le pasa al archivo elegido antes de enviarlo, para responder en el acto; la autoridad sigue siendo la API. */
export type CvLocalProblem = 'type' | 'size';

/**
 * Lo que se dice cuando la subida no sale. `type` y `size` los dice también la comprobación local, con el mismo texto:
 * a la persona le da igual quién se dio cuenta. `tooMany` es el tope de CV guardados y `request` es todo lo demás,
 * que explica `lv-request-error` (el límite con su espera, sin conexión y el genérico).
 */
export type CvUploadProblem = CvLocalProblem | 'tooMany' | 'request';

/**
 * Subida del CV (D13, spec web/cv "Subir el CV con progreso"). El **botón es la vía principal** y soltar el archivo es
 * la alternativa: soltar es un gesto que mucha gente no descubre, así que no puede ser la única entrada.
 *
 * Comprueba extensión y tamaño antes de enviar para dar respuesta inmediata, pero **la autoridad es la API**: un `415`
 * o un `413` se muestran igual aunque la comprobación local haya pasado.
 */
@Component({
  selector: 'lv-cv-upload',
  imports: [MatButtonModule, MatProgressBarModule, RequestError],
  templateUrl: './cv-upload.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CvUpload {
  /** `true` mientras una subida está en curso: el control se bloquea y no acepta una segunda. */
  readonly uploading = input(false);
  /** Porcentaje subido, o `null` mientras no se sepa; con `null` la barra va en indeterminado. */
  readonly percent = input<number | null>(null);
  /** Lo que respondió la API al último intento; manda sobre la comprobación local. */
  readonly failure = input<RequestFailure | null>(null);

  /** El archivo elegido, ya pasadas las comprobaciones locales. */
  readonly chosen = output<File>();

  protected readonly accept = CV_UPLOAD_ACCEPT;
  /** Lo que la comprobación local encontró en el último archivo elegido; se borra al elegir otro. */
  protected readonly localProblem = signal<CvLocalProblem | null>(null);
  protected readonly dragging = signal(false);
  protected readonly progressMode = computed(() =>
    this.percent() === null ? 'indeterminate' : 'determinate',
  );

  /**
   * Qué se dice: primero lo que encontró la comprobación local —que es de este intento— y, si no hay nada, lo que
   * respondió la API. Un `415` o un `413` se muestran igual aunque la comprobación local hubiera pasado.
   */
  protected readonly problem = computed((): CvUploadProblem | null => {
    const local = this.localProblem();
    if (local !== null) {
      return local;
    }
    const failure = this.failure();
    if (failure === null) {
      return null;
    }
    if (isApiFailure(failure, 415, 'unsupported_file_type')) {
      return 'type';
    }
    if (isApiFailure(failure, 413, 'file_too_large')) {
      return 'size';
    }
    return isApiFailure(failure, 409, 'too_many_cvs') ? 'tooMany' : 'request';
  });

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  /** El botón abre el selector; el `input[type=file]` está oculto para poder darle el aspecto del resto de botones. */
  protected choose(): void {
    if (!this.uploading()) {
      this.fileInput().nativeElement.click();
    }
  }

  protected onSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Se limpia el valor para que elegir **el mismo** archivo otra vez vuelva a disparar el evento.
    input.value = '';
    if (file !== undefined) {
      this.offer(file);
    }
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(!this.uploading());
  }

  protected onDragLeave(): void {
    this.dragging.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file !== undefined) {
      this.offer(file);
    }
  }

  /** Comprueba el archivo y, si sirve, lo ofrece hacia arriba. Mientras sube, no se acepta ninguno más. */
  private offer(file: File): void {
    if (this.uploading()) {
      return;
    }
    const problem = problemWith(file);
    this.localProblem.set(problem);
    if (problem === null) {
      this.chosen.emit(file);
    }
  }
}

/** Extensión y tamaño, en ese orden: a quien elige un `.odt` de 7 MB se le dice primero que no admitimos ese formato. */
function problemWith(file: File): CvLocalProblem | null {
  const name = file.name.toLowerCase();
  if (!CV_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return 'type';
  }
  return file.size > CV_MAX_FILE_BYTES ? 'size' : null;
}
